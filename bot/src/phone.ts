import { parsePhoneNumberFromString } from "libphonenumber-js";

/** "+1 (212) 555-0148", "212 555 0148" -> "+12125550148"; null if invalid. US when no country code, like the app. */
export function normalizePhone(raw: string): string | null {
  const parsed = parsePhoneNumberFromString(raw.trim(), "US");
  return parsed && parsed.isValid() ? parsed.number : null;
}

/** The phone number in a WhatsApp phone JID ("12125550148:3@s.whatsapp.net"), as E.164. */
export function phoneFromJid(jid: string | null | undefined): string | null {
  const m = jid?.match(/^(\d{7,15})(?::\d+)?@s\.whatsapp\.net$/);
  return m ? `+${m[1]}` : null;
}

/** "wa.me/12125550148?text=link": opens a DM to the bot with "link" typed in. */
export const linkUrl = (botPhone: string) => `https://wa.me/${botPhone.replace(/^\+/, "")}?text=link`;
