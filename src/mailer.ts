import nodemailer, { type Transporter } from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import { config } from './config.js';

// Port 587 + STARTTLS: antivirus mail shields (e.g. Avast) intercept port 465 with an untrusted certificate.
const GMAIL_SMTP = { host: 'smtp.gmail.com', port: 587, secure: false, requireTLS: true } as const;

let transporter: Transporter | undefined;

/** Gmail via OAuth2 when GMAIL_OAUTH_* are set, otherwise via app password. */
function getTransporter(): Transporter {
  if (transporter) return transporter;
  const { clientId, clientSecret, refreshToken } = config.gmailOAuth;
  if (!config.gmailUser) throw new Error('GMAIL_USER is not set in .env');
  if (clientId && clientSecret && refreshToken) {
    transporter = nodemailer.createTransport({
      ...GMAIL_SMTP,
      auth: { type: 'OAuth2', user: config.gmailUser, clientId, clientSecret, refreshToken },
    });
  } else if (config.gmailAppPassword) {
    transporter = nodemailer.createTransport({
      ...GMAIL_SMTP,
      auth: { user: config.gmailUser, pass: config.gmailAppPassword },
    });
  } else {
    throw new Error('No Gmail credentials: set GMAIL_APP_PASSWORD or GMAIL_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN in .env');
  }
  return transporter;
}

export async function verifyMailer() {
  await getTransporter().verify();
}

export async function sendMail({ fromName = 'ams-bot', ...opts }: { to: string; subject: string; text: string; html?: string; attachments?: Mail.Attachment[]; replyTo?: string; fromName?: string }) {
  const info = await getTransporter().sendMail({
    from: { name: fromName, address: config.gmailUser },
    ...opts,
  });
  return info.messageId;
}
