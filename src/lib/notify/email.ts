import "server-only";
import nodemailer from "nodemailer";
import { env } from "../env";
import type { Channel, OutgoingMessage } from "./channel";

export const FROM_NAME = "CBS FC · The List";

/** Sends through the club Gmail account (smtp.gmail.com, ~500 emails/day). */
function gmailChannel(user: string, pass: string): Channel {
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  return {
    name: "gmail",
    async send(m: OutgoingMessage) {
      await transport.sendMail({ from: { name: FROM_NAME, address: user }, to: m.to, subject: m.subject, html: m.html, text: m.text });
    },
  };
}

/** For local development without Gmail set up: prints emails to the server log. */
const logChannel: Channel = {
  name: "log",
  async send(m) {
    console.log(`\n✉️  To: ${m.to}\n   Subject: ${m.subject}\n${m.text.replace(/^/gm, "   ")}\n`);
  },
};

export function emailChannel(): Channel {
  const user = env.gmailUser;
  const pass = env.gmailAppPassword;
  return user && pass ? gmailChannel(user, pass) : logChannel;
}
