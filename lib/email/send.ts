import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { LOGO_CID, signInCodeHtml, signInCodeText } from './signInCode';

/**
 * Sign-in codes go out from Zing's own Gmail account over Gmail's SMTP.
 * Gmail signs them with its own DKIM, which is what keeps them out of spam;
 * Firebase's shared firebaseapp.com sender did not.
 *
 * A free Gmail account sends about 500 emails a day. Moving to a domain of
 * our own later only means changing these settings.
 */
let transport: Transporter | null = null;

function mailer(): Transporter {
  if (transport) return transport;
  const user = process.env.GMAIL_SMTP_USER;
  const pass = process.env.GMAIL_SMTP_APP_PASSWORD;
  if (!user || !pass) throw new Error('GMAIL_SMTP_USER / GMAIL_SMTP_APP_PASSWORD are not set');
  transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  return transport;
}

export async function sendSignInCode(to: string, code: string): Promise<void> {
  const from = process.env.GMAIL_SMTP_USER!;
  await mailer().sendMail({
    from: { name: 'Zing', address: from },
    to,
    // In the subject too, so it shows in the notification without opening.
    subject: `${code} is your Zing code`,
    text: signInCodeText(code),
    html: signInCodeHtml(code),
    attachments: [
      {
        filename: 'zing.png',
        path: path.join(process.cwd(), 'public', 'icon-192.png'),
        cid: LOGO_CID,
      },
    ],
  });
}
