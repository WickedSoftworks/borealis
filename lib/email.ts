import nodemailer, { type Transporter } from "nodemailer";
import { appUrl } from "@/lib/appUrl";

/**
 * SMTP delivery.
 *
 * Mail is optional: a self-hosted instance may have no SMTP at all, and the
 * product still works without it (invitations are handed over out-of-band).
 * When it isn't configured, mail is written to the server log instead of being
 * dropped silently — an operator debugging "the reset link never arrived"
 * should find the link, and the reason, in their own logs.
 */

let cached: Transporter | null | undefined;

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function transport(): Transporter | null {
  if (cached !== undefined) return cached;

  if (!mailConfigured()) {
    cached = null;
    return cached;
  }

  const port = Number(process.env.SMTP_PORT ?? 587);

  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // 465 is implicit TLS; 587 and 25 start plaintext and upgrade via STARTTLS.
    secure: process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE === "true"
      : port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });

  return cached;
}

export type Mail = {
  to: string;
  subject: string;
  text: string;
};

export async function sendMail({ to, subject, text }: Mail): Promise<void> {
  const mailer = transport();

  if (!mailer) {
    console.warn(
      [
        "",
        "  SMTP is not configured — this message was not sent.",
        `  to:      ${to}`,
        `  subject: ${subject}`,
        "",
        text.replace(/^/gm, "  "),
        "",
        "  Set SMTP_HOST and SMTP_FROM to deliver mail.",
        "",
      ].join("\n"),
    );
    return;
  }

  await mailer.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text,
    // Plain text only. A file host emailing rich HTML is a phishing lesson
    // nobody needs, and text renders everywhere.
  });
}

export function verificationEmail(url: string): Omit<Mail, "to"> {
  return {
    subject: "Confirm your email for Borealis",
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

export function resetEmail(url: string): Omit<Mail, "to"> {
  return {
    subject: "Reset your Borealis password",
    text: [
      "Someone asked to reset the password on your Borealis account.",
      "",
      url,
      "",
      "The link expires in one hour and can be used once.",
      "If it wasn't you, ignore this — nothing has changed.",
    ].join("\n"),
  };
}

export function downloadEmail(
  shareName: string,
  fileName: string,
): Omit<Mail, "to"> {
  return {
    subject: `Your Borealis share was downloaded`,
    text: [
      `Someone downloaded a file from your shared link.`,
      "",
      `Share: ${shareName}`,
      `File: ${fileName}`,
      "",
      `If you did not expect this download, you may want to review or revoke the share.`,
    ].join("\n"),
  };
}
