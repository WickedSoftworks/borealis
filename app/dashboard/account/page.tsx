import { getAuthenticatorName } from "@better-auth/passkey";
import { DeleteAccount } from "@/components/account/delete-account";
import { PasskeysPanel } from "@/components/account/passkeys";
import {
  EmailForm,
  NameForm,
  PasswordForm,
} from "@/components/account/profile-forms";
import { SessionsList } from "@/components/account/sessions-list";
import { TwoFactorPanel } from "@/components/account/two-factor";
import { QuotaMeter } from "@/components/quota-meter";
import { DataRow, Panel } from "@/components/world/panel";
import { db } from "@/lib/db";
import { formatAddress } from "@/lib/format-address";
import { ROOT_USER_ID } from "@/lib/invites";
import { accountUsage } from "@/lib/quota";
import { getSession } from "@/lib/session";
import { describeUserAgent } from "@/lib/user-agent";

export const metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

const PROVIDER_LABELS: Record<string, string> = {
  credential: "Email and password",
  github: "GitHub",
  google: "Google",
  discord: "Discord",
  microsoft: "Microsoft",
  oidc: "Single sign-on",
};

/**
 * Everything about your own account in one place: who you are, how you sign
 * in, where you are signed in, what you are using, and how to leave.
 *
 * Before this the only way to change a password was the emailed reset — which
 * needs a confirmed address and, without SMTP, shell access to the box.
 */
export default async function AccountPage() {
  const session = await getSession();
  if (!session) return null;

  const userId = session.user.id;

  const [user, accounts, sessions, usage, fileCount, liveLinks, passkeys] =
    await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          email: true,
          emailVerified: true,
          twoFactorEnabled: true,
          role: true,
          createdAt: true,
        },
      }),
      db.account.findMany({
        where: { userId },
        select: { providerId: true, createdAt: true },
      }),
      db.session.findMany({
        where: { userId, expiresAt: { gt: new Date() } },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
          updatedAt: true,
          impersonatedBy: true,
        },
      }),
      accountUsage(userId),
      db.file.count({ where: { ownerId: userId } }),
      db.share.count({ where: { ownerId: userId, revokedAt: null } }),
      db.passkey.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          aaguid: true,
          backedUp: true,
          createdAt: true,
        },
      }),
    ]);

  if (!user) return null;

  const hasPassword = accounts.some(
    (account) => account.providerId === "credential",
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[0.9375rem] text-ink-90">Account</h1>

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <Panel title="Profile">
          <div className="flex flex-col gap-6">
            <NameForm name={user.name} />
            <EmailForm email={user.email} verified={user.emailVerified} />
          </div>
        </Panel>

        <Panel title="Usage">
          <QuotaMeter
            used={Number(usage.used)}
            trash={Number(usage.trash)}
            reserved={Number(usage.reserved)}
            limit={usage.limit === null ? null : Number(usage.limit)}
          />
          <DataRow label="Files">{fileCount}</DataRow>
          <DataRow label="Live links">{liveLinks}</DataRow>
          <DataRow label="Role">{user.role ?? "user"}</DataRow>
          <DataRow label="Since">
            {user.createdAt.toISOString().slice(0, 10)}
          </DataRow>
        </Panel>
      </div>

      <Panel title="Sign-in methods">
        <ul className="flex flex-wrap gap-2">
          {accounts.map((account) => (
            <li
              key={account.providerId}
              className="border border-dotted border-ink-40 px-2 py-1 text-[0.75rem] text-ink-80"
            >
              {PROVIDER_LABELS[account.providerId] ?? account.providerId}
            </li>
          ))}
          {passkeys.length > 0 && (
            <li className="border border-dotted border-ink-40 px-2 py-1 text-[0.75rem] text-ink-80">
              Passkey{passkeys.length === 1 ? "" : `s (${passkeys.length})`}
            </li>
          )}
        </ul>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Password">
          <PasswordForm hasPassword={hasPassword} />
        </Panel>

        <Panel title="Two-step sign-in">
          <TwoFactorPanel
            enabled={Boolean(user.twoFactorEnabled)}
            hasPassword={hasPassword}
          />
        </Panel>
      </div>

      <Panel title="Passkeys">
        <PasskeysPanel
          passkeys={passkeys.map((row) => ({
            id: row.id,
            // The name given at enrolment, else what the authenticator model
            // is known as, else a plain label. Apple zeroes the model id, so
            // the last is common and fine.
            label:
              row.name?.trim() || getAuthenticatorName(row.aaguid) || "Passkey",
            createdAt: row.createdAt?.toISOString() ?? null,
            synced: row.backedUp,
          }))}
        />
      </Panel>

      <Panel title="Where you are signed in">
        <SessionsList
          sessions={sessions.map((row) => ({
            id: row.id,
            device: describeUserAgent(row.userAgent),
            ipAddress: formatAddress(row.ipAddress),
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
            current: row.id === session.session.id,
            impersonated: row.impersonatedBy !== null,
          }))}
        />
      </Panel>

      <Panel title="Delete account">
        <DeleteAccount
          email={user.email}
          fileCount={fileCount}
          storedBytes={Number(usage.used)}
          liveLinks={liveLinks}
          hasPassword={hasPassword}
          blocked={
            userId === ROOT_USER_ID
              ? "The root account is the instance's authority and is managed from the console. It cannot delete itself here."
              : null
          }
        />
      </Panel>
    </div>
  );
}
