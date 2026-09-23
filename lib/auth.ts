import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { admin } from "better-auth/plugins/admin";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { db } from "@/lib/db";
import {
  changeEmailConfirmation,
  resetEmail,
  sendMail,
  verificationEmail,
} from "@/lib/email";
import { hashInviteCode, INVITE_COOKIE, ROOT_USER_ID } from "@/lib/invites";
import { log } from "@/lib/log";
import { getSettings } from "@/lib/settings";
import { storage } from "@/lib/storage";

type SocialProvider = { clientId: string; clientSecret: string };

/**
 * The request header better-auth reads the caller's address from.
 *
 * Set by the auth route handler (app/api/auth/[...all]/route.ts), which first
 * throws away any value the client sent. Left to its defaults better-auth
 * trusts the leftmost `X-Forwarded-For` — forgeable on every deployment — for
 * both its rate limiter and the address it records on a session. Pointing it
 * at a header only the server writes puts both under TRUST_PROXY, the same
 * policy the share audit log follows.
 */
export const CLIENT_IP_HEADER = "x-borealis-client-ip";

/**
 * Only register a provider when both halves of its credential pair are present.
 * The previous `process.env.X!` assertions meant an unset provider booted with
 * `undefined` credentials and failed confusingly at sign-in time.
 */
function socialProvider(prefix: string): SocialProvider | null {
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];

  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

const socialProviders: Record<string, SocialProvider> = {};

for (const [name, prefix] of [
  ["discord", "DISCORD"],
  ["github", "GITHUB"],
  ["google", "GOOGLE"],
  ["microsoft", "MICROSOFT"],
] as const) {
  const config = socialProvider(prefix);

  if (config) {
    socialProviders[name] = config;
  }
}

/** Generic OIDC SSO, for parity with Palmr's "connect your own provider". */
const oidcConfigs =
  process.env.OIDC_ISSUER &&
  process.env.OIDC_CLIENT_ID &&
  process.env.OIDC_CLIENT_SECRET
    ? [
        {
          providerId: "oidc",
          discoveryUrl: `${process.env.OIDC_ISSUER.replace(/\/$/, "")}/.well-known/openid-configuration`,
          clientId: process.env.OIDC_CLIENT_ID,
          clientSecret: process.env.OIDC_CLIENT_SECRET,
          scopes: ["openid", "profile", "email"],
        },
      ]
    : [];

/**
 * Storage keys an account's deletion must remove. Collected before the row
 * goes, because the cascade takes the `File` rows — and with them the only
 * record of where the bytes live — along with the user.
 */
const pendingDeletion = new Map<string, string[]>();

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider:
      process.env.DATABASE_PROVIDER === "postgresql" ? "postgresql" : "sqlite",
  }),
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,

    /**
     * Password reset is gated on a confirmed address.
     *
     * An unverified address is not evidence of anything — anyone can type
     * someone else's email at sign-up. Letting it receive a reset link would
     * turn account creation into account takeover. better-auth has no built-in
     * flag for this, so the refusal lives here.
     *
     * The endpoint still returns success either way: telling the caller "that
     * address isn't verified" would confirm the account exists.
     */
    async sendResetPassword({ user, url }) {
      if (!user.emailVerified) {
        log.warn("auth.reset_refused_unverified", { email: user.email });
        return;
      }

      const { instanceName } = await getSettings();
      await sendMail({ to: user.email, ...resetEmail(url, instanceName) });
    },

    resetPasswordTokenExpiresIn: 60 * 60,

    // A reset is what someone does after losing control of a password. Every
    // session opened with the old one should end with it.
    revokeSessionsOnPasswordReset: true,
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    async sendVerificationEmail({ user, url }) {
      const { instanceName } = await getSettings();
      await sendMail({
        to: user.email,
        ...verificationEmail(url, instanceName),
      });
    },
  },

  user: {
    /**
     * A verified address is confirmed from the OLD address before anything
     * changes, then verified at the new one. The first step is what stops a
     * stolen session from quietly moving the account's recovery address to
     * the thief's inbox. An unverified address has nothing to protect, so it
     * changes directly.
     */
    changeEmail: {
      enabled: true,
      updateEmailWithoutVerification: true,
      async sendChangeEmailConfirmation({ user, newEmail, url }) {
        const { instanceName } = await getSettings();
        await sendMail({
          to: user.email,
          ...changeEmailConfirmation(url, newEmail, instanceName),
        });
      },
    },

    /**
     * Self-service deletion. better-auth demands the password (or a fresh
     * session for accounts without one) before it gets here.
     */
    deleteUser: {
      enabled: true,

      async beforeDelete(user) {
        // Root is the instance's authority and is managed from the console.
        // Deleting it from a browser would leave nobody able to mint an admin.
        if (user.id === ROOT_USER_ID) {
          throw new APIError("FORBIDDEN", {
            message: "The root account is managed from the console.",
          });
        }

        const files = await db.file.findMany({
          where: { ownerId: user.id },
          select: { storageKey: true, thumbnailKey: true },
        });

        pendingDeletion.set(
          user.id,
          files.flatMap((file) =>
            file.thumbnailKey
              ? [file.storageKey, file.thumbnailKey]
              : [file.storageKey],
          ),
        );
      },

      /**
       * The rows are gone; now the bytes. Best effort, one at a time: anything
       * that cannot be reached is left for the storage reconciliation sweep,
       * which removes objects no row points at.
       */
      async afterDelete(user) {
        const keys = pendingDeletion.get(user.id) ?? [];
        pendingDeletion.delete(user.id);

        let failed = 0;

        for (const key of keys) {
          try {
            await storage.delete(key);
          } catch {
            failed++;
          }
        }

        log.info("account.deleted", {
          userId: user.id,
          objects: keys.length,
          orphaned: failed,
        });
      },
    },
  },

  /*
    Rate limiting.

    On in every environment, not only production — the unlock and invite
    limits in lib/rate-limit.ts are too, and a brute-force defence that
    vanishes in whatever mode someone happened to deploy is not one. Stored in
    the database so a restart does not reset anyone's window.
  */
  rateLimit: {
    enabled: process.env.RATE_LIMIT?.toLowerCase() !== "off",
    storage: "database",
    window: 60,
    max: 120,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60 * 10, max: 5 },
      "/two-factor/verify-totp": { window: 60, max: 5 },
      "/two-factor/verify-backup-code": { window: 60, max: 5 },
      "/request-password-reset": { window: 60 * 15, max: 3 },
      "/change-password": { window: 60, max: 5 },
      "/delete-user": { window: 60, max: 5 },
    },
  },

  advanced: {
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
  },

  socialProviders,
  plugins: [
    admin(),
    twoFactor({
      // What the authenticator app shows next to the code. Read once at boot:
      // renaming the instance later does not rename existing enrolments, and
      // a TOTP label is not worth a restart to change.
      issuer: process.env.INSTANCE_NAME?.trim() || "Borealis",
    }),
    ...(oidcConfigs.length ? [genericOAuth({ config: oidcConfigs })] : []),
  ],

  /*
    The invitation gate.

    This runs for every path that can bring an account into existence — email
    sign-up, each social provider, and OIDC — so there is exactly one place to
    get right. Gating the sign-up form alone would leave "Continue with GitHub"
    wide open.
  */
  databaseHooks: {
    user: {
      create: {
        async before(user, context) {
          const code = context?.request
            ? readInviteCookie(context.request.headers.get("cookie"))
            : null;

          const invite = await consumableInvite(code);

          if (!invite) {
            throw new APIError("FORBIDDEN", {
              message:
                "An invitation code is required to create an account on this instance.",
            });
          }

          // The role comes from the invite, never from the client.
          return { data: { ...user, role: invite.grantsRole } };
        },

        async after(user, context) {
          const code = context?.request
            ? readInviteCookie(context.request.headers.get("cookie"))
            : null;

          if (!code) return;

          // Burn the code. Scoped to still-unredeemed rows so two concurrent
          // sign-ups cannot both claim the same invite.
          await db.invite.updateMany({
            where: { codeHash: hashInviteCode(code), redeemedAt: null },
            data: { redeemedAt: new Date(), redeemedById: user.id },
          });
        },
      },
    },
  },
});

function readInviteCookie(header: string | null): string | null {
  if (!header) return null;

  const match = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${INVITE_COOKIE}=`));

  if (!match) return null;

  return decodeURIComponent(match.slice(INVITE_COOKIE.length + 1)) || null;
}

/** A code that exists, is unspent, unrevoked, and unexpired — or null. */
async function consumableInvite(code: string | null) {
  if (!code) return null;

  const invite = await db.invite.findUnique({
    where: { codeHash: hashInviteCode(code) },
    select: {
      grantsRole: true,
      expiresAt: true,
      revokedAt: true,
      redeemedAt: true,
    },
  });

  if (!invite || invite.revokedAt || invite.redeemedAt) return null;
  if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) return null;

  return invite;
}
