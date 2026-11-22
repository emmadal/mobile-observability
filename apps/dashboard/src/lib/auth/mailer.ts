export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

function redact(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Outgoing mail hook. No provider ships by default (self-hosted). Message
 * bodies can contain sign-in tokens, so they are only printed in development
 * (or with MAIL_LOG_LINKS=true for a deliberate manual relay).
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  if (process.env.MAIL_PROVIDER_CONFIGURED === 'true') {
    throw new Error(
      'MAIL_PROVIDER_CONFIGURED=true but no mail provider is wired in src/lib/auth/mailer.ts',
    );
  }
  const logBody = process.env.NODE_ENV !== 'production' || process.env.MAIL_LOG_LINKS === 'true';
  console.info(
    `[mail] to=${redact(message.to)} subject="${message.subject}"${logBody ? `\n${message.text}` : ''}`,
  );
}
