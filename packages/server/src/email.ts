import nodemailer from "nodemailer";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

export function createEmailTransport(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.password },
  });
}

export async function verifyEmailTransport(transport: nodemailer.Transporter): Promise<boolean> {
  try {
    await transport.verify();
    return true;
  } catch {
    return false;
  }
}

export async function sendVerificationEmail(
  transport: nodemailer.Transporter,
  to: string,
  verifyUrl: string,
  botName: string,
  from: string,
): Promise<void> {
  await transport.sendMail({
    from: `${botName} <${from}>`,
    to,
    subject: "Verify your email address",
    html: `<p>Click the link below to verify your email address:</p>
<p><a href="${escapeHtml(verifyUrl)}">${escapeHtml(verifyUrl)}</a></p>
<p>This link expires in 24 hours.</p>`,
  });
}

export async function sendMagicLinkEmail(
  transport: nodemailer.Transporter,
  to: string,
  magicLinkUrl: string,
  botName: string,
  from: string,
): Promise<void> {
  await transport.sendMail({
    from: `${botName} <${from}>`,
    to,
    subject: `Sign in to ${botName}`,
    html: `<p>Click the link below to sign in:</p>
<p><a href="${escapeHtml(magicLinkUrl)}">${escapeHtml(magicLinkUrl)}</a></p>
<p>This link expires in 15 minutes and can only be used once.</p>`,
  });
}
