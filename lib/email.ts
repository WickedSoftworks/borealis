import nodemailer, { type Transporter } from "nodemailer";
import { appUrl } from "@/lib/appUrl";
import { formatBytes } from "@/lib/format";
import { log } from "@/lib/log";
import { getSettings, type MailSettings } from "@/lib/settings";

/**
 * SMTP delivery.
 *
 * Mail is optional: a self-hosted instance may have no SMTP at all, and the
 * product still works without it (invitations are handed over out-of-band).
 * When it isn't configured, mail is written to the server log instead of being
 * dropped silently — an operator debugging "the reset link never arrived"
 * should find the link, and the reason, in their own logs.
 *
 * The transport is read from lib/settings.ts, so SMTP set in the admin panel
 * takes effect on the next message without a restart. It is rebuilt only when
 * the configuration actually changes.
 */

let cached: { signature: string; transport: Transporter } | null = null;

function configured(mail: MailSettings): boolean {
  return Boolean(mail.host && mail.from);
}

export async function mailConfigured(): Promise<boolean> {
  return configured((await getSettings()).mail);
}

function transportFor(mail: MailSettings): Transporter {
  const signature = JSON.stringify(mail);

  if (cached?.signature === signature) return cached.transport;

  const transport = nodemailer.createTransport({
    host: mail.host ?? undefined,
    port: mail.port,
    // 465 is implicit TLS; 587 and 25 start plaintext and upgrade via STARTTLS.
    secure: mail.secure ?? mail.port === 465,
    auth: mail.user
      ? { user: mail.user, pass: mail.password ?? undefined }
      : undefined,
  });

  cached = { signature, transport };
  return transport;
}

export type Mail = {
  to: string;
  subject: string;
  text: string;
};

export async function sendMail({ to, subject, text }: Mail): Promise<void> {
  const { mail } = await getSettings();

  if (!configured(mail)) {
    // Deliberately a readable block rather than a structured event: this is
    // the one log line an operator is expected to copy a link out of.
    console.warn(
      [
        "",
        "  SMTP is not configured — this message was not sent.",
        `  to:      ${to}`,
        `  subject: ${subject}`,
        "",
        text.replace(/^/gm, "  "),
        "",
        "  Set SMTP_HOST and SMTP_FROM, or configure mail in the admin panel.",
        "",
      ].join("\n"),
    );
    return;
  }

  await transportFor(mail).sendMail({
    from: mail.from ?? undefined,
    to,
    subject,
    text,
    // Plain text only. A file host emailing rich HTML is a phishing lesson
    // nobody needs, and text renders everywhere.
  });
}

/**
 * Send one message and report exactly what the SMTP server said.
 *
 * For the admin panel's "send test email" button, which exists because a
 * misconfigured relay otherwise fails silently at 3 a.m. inside a password
 * reset. Unlike `sendMail`, this never falls back to the log: the operator
 * asked whether mail works, and "it was printed" is not a yes.
 */
export async function sendTestMail(
  to: string,
): Promise<{ ok: true; response: string } | { ok: false; error: string }> {
  const settings = await getSettings();

  if (!configured(settings.mail)) {
    return {
      ok: false,
      error: "Mail is not configured: a host and a From address are required.",
    };
  }

  try {
    const transport = transportFor(settings.mail);
    await transport.verify();

    const info = await transport.sendMail({
      from: settings.mail.from ?? undefined,
      to,
      subject: `Test message from ${settings.instanceName}`,
      text: [
        `This is a test message from ${settings.instanceName} at ${appUrl()}.`,
        "",
        "If you are reading it, password resets and download notifications",
        "will reach their recipients too.",
      ].join("\n"),
    });

    return { ok: true, response: String(info.response ?? "accepted") };
  } catch (error) {
    log.warn("mail.test_failed", { error });
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function verificationEmail(
  url: string,
  instanceName = "Borealis",
): Omit<Mail, "to"> {
  return {
    subject: `Confirm your email for ${instanceName}`,
    text: [
      "Confirm this address so it can be used to recover your account.",
      "",
      url,
      "",
      "Until you confirm, password reset is disabled for this account —",
      "an unconfirmed address is not proof of anything.",
      "",
      `If you didn't create an account at ${appUrl()}, ignore this.`,
    ].join("\n"),
  };
}

export function resetEmail(
  url: string,
  instanceName = "Borealis",
): Omit<Mail, "to"> {
  return {
    subject: `Reset your ${instanceName} password`,
    text: [
      `Someone asked to reset the password on your ${instanceName} account.`,
      "",
      url,
      "",
      "The link expires in one hour and can be used once.",
      "If it wasn't you, ignore this — nothing has changed.",
    ].join("\n"),
  };
}

export function changeEmailConfirmation(
  url: string,
  newEmail: string,
  instanceName = "Borealis",
): Omit<Mail, "to"> {
  return {
    subject: `Confirm the new email on your ${instanceName} account`,
    text: [
      `Someone asked to change the email on your ${instanceName} account to:`,
      "",
      `  ${newEmail}`,
      "",
      "Confirm it here. Nothing changes until you do:",
      "",
      url,
      "",
      "If this wasn't you, ignore this message and change your password.",
    ].join("\n"),
  };
}

export type DownloadNotice = {
  instanceName: string;
  shareName: string | null;
  sharePath: string;
  fileName: string | null;
  fileSize: bigint | null;
  ipAddress: string | null;
  at: Date;
  downloadsLeft: number | null;
};

/**
 * "Your link was used."
 *
 * Says what was taken, when, and from where — the three things an owner needs
 * to decide whether that download was the one they expected. The address is
 * reported as the server saw it, which behind a misconfigured proxy is not
 * much; saying "not recorded" beats inventing one.
 */
export function downloadEmail(notice: DownloadNotice): Omit<Mail, "to"> {
  const label = notice.shareName ?? notice.sharePath;

  return {
    subject: `Downloaded from your link: ${label}`,
    text: [
      `A file was downloaded through a link you shared from ${notice.instanceName}.`,
      "",
      `  Link:  ${label}`,
      `  File:  ${notice.fileName ?? "(since deleted)"}${
        notice.fileSize !== null
          ? ` — ${formatBytes(Number(notice.fileSize))}`
          : ""
      }`,
      `  When:  ${notice.at.toUTCString()}`,
      `  From:  ${notice.ipAddress ?? "address not recorded"}`,
      ...(notice.downloadsLeft !== null
        ? [
            `  Left:  ${notice.downloadsLeft} download${notice.downloadsLeft === 1 ? "" : "s"}`,
          ]
        : []),
      "",
      "If you did not expect this, revoke the link from your dashboard:",
      `${appUrl()}/dashboard`,
      "",
      "Notifications for one link are limited to ten an hour. The access log",
      "in your dashboard records every download regardless.",
    ].join("\n"),
  };
}
