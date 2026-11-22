export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Outgoing mail hook. No provider ships by default (self-hosted); messages are
 * logged on the server so an operator can relay them. Plug a provider here and
 * set MAIL_PROVIDER_CONFIGURED=true to enforce verified invitations.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  console.info(`[mail] to=${message.to} subject="${message.subject}"\n${message.text}`);
}
