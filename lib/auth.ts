import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { admin } from "better-auth/plugins/admin";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { db } from "@/lib/db";
import { resetEmail, sendMail, verificationEmail } from "@/lib/email";
import { hashInviteCode, INVITE_COOKIE } from "@/lib/invites";

type SocialProvider = { clientId: string; clientSecret: string };

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
        console.warn(
          `Password reset refused for ${user.email}: address is not verified.`,
        );
        return;
      }

      await sendMail({ to: user.email, ...resetEmail(url) });
    },

    resetPasswordTokenExpiresIn: 60 * 60,
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    async sendVerificationEmail({ user, url }) {
      await sendMail({ to: user.email, ...verificationEmail(url) });
    },
  },

  socialProviders,
  plugins: [
    admin(),
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
