import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { authClient, db } from "./supabase";

// Board login. The email carries a link and a code that the app signs itself,
// both tied to the moment the email was sent (board_members.last_login_link_at):
//
// - The link logs you in with one tap and keeps working for 15 minutes, so the
//   email scanners that open every link first can't use it up.
// - The code is for the home-screen app, which doesn't share Safari's login.
// - Asking for a new email changes last_login_link_at, which kills both.
//
// Supabase only comes in at the moment of login, to start the session.

export const LOGIN_TTL_MS = 15 * 60_000;
const CODE_DIGITS = 8;

const hmac = (purpose: string, value: string) => createHmac("sha256", env.dropLinkSecret).update(`${purpose}:${value}`).digest();

/** The link token: "<email, issued at>.<signature>". */
export function loginToken(email: string, issuedAt: number) {
  const body = Buffer.from(JSON.stringify({ e: email, i: issuedAt })).toString("base64url");
  return `${body}.${hmac("login-link", body).toString("base64url").slice(0, 32)}`;
}

export function loginUrl(email: string, issuedAt: number) {
  return `${env.siteUrl}/admin/auth/link/${loginToken(email, issuedAt)}`;
}

/** The emailed code, derived from the same email + moment, so nothing extra is stored. */
export function loginCode(email: string, issuedAt: number) {
  const n = hmac("login-code", `${email}:${issuedAt}`).readBigUInt64BE(0) % BigInt(10 ** CODE_DIGITS);
  return n.toString().padStart(CODE_DIGITS, "0");
}

export function readLoginToken(token: string): { email: string; issuedAt: number } | null {
  const parts = decodeURIComponent(token).split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = Buffer.from(hmac("login-link", body).toString("base64url").slice(0, 32));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { e, i } = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return typeof e === "string" && typeof i === "number" ? { email: e, issuedAt: i } : null;
  } catch {
    return null;
  }
}

/** True when the email is still the latest one sent and less than 15 minutes old. */
export function isCurrent(issuedAt: number, lastLoginLinkAt: string | null, now = Date.now()) {
  return lastLoginLinkAt !== null && Date.parse(lastLoginLinkAt) === issuedAt && now - issuedAt < LOGIN_TTL_MS;
}

/** Compares a typed code with the expected one, ignoring spaces. */
export function codeMatches(typed: string, expected: string) {
  const a = Buffer.from(typed.replace(/\D/g, ""));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Starts a Supabase session for this email in the current request's cookies.
 * Callers must have checked the link or code, and that the email is on the board.
 */
export async function startSession(email: string): Promise<boolean> {
  const admin = db();
  let link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const user = link.data?.user;
  if (link.error || !user?.email_confirmed_at) {
    // First login: generateLink makes an unconfirmed account and returns a
    // signup token, which verifyOtp({ type: "magiclink" }) rejects. Confirm the
    // account (board_members already vouches for the email), then try again.
    if (user) await admin.auth.admin.updateUserById(user.id, { email_confirm: true });
    else await admin.auth.admin.createUser({ email, email_confirm: true });
    link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  }
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) {
    console.error("Login session failed", link.error);
    return false;
  }
  const { error } = await (await authClient()).auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (error) console.error("Login session failed", error);
  return !error;
}
