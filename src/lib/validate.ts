import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { z } from "zod";

/** Normalizes a phone number to international format (+12125550148), or returns null if invalid. */
export function normalizePhone(raw: string, country: CountryCode = "US"): string | null {
  const parsed = parsePhoneNumberFromString(raw.trim(), country);
  return parsed && parsed.isValid() ? parsed.number : null;
}

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email({ message: "That email doesn't look right." }));
export const nameSchema = z.string().trim().min(2, "Please add your full name.").max(80);
