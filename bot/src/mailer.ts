import nodemailer from "nodemailer";

// Email through the club Gmail, like the app (src/lib/notify/email.ts). With
// no Gmail settings, emails are printed to the terminal instead.

export type Mail = { to: string; subject: string; text: string; html?: string };
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export const FROM_NAME = "CBS FC · The List";

export function gmailMailer(user: string, pass: string): Mailer {
  const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
  return {
    async send(m) {
      await transport.sendMail({ from: { name: FROM_NAME, address: user }, to: m.to, subject: m.subject, text: m.text, html: m.html });
    },
  };
}

export const logMailer: Mailer = {
  async send(m) {
    console.log(`\n✉️  To: ${m.to}\n   Subject: ${m.subject}\n${m.text.replace(/^/gm, "   ")}\n`);
  },
};

export function mailerFor(cfg: { gmailUser: string | null; gmailAppPassword: string | null }): Mailer {
  return cfg.gmailUser && cfg.gmailAppPassword ? gmailMailer(cfg.gmailUser, cfg.gmailAppPassword) : logMailer;
}
