"use server";

import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { codeMatches, isCurrent, loginCode, loginUrl, startSession } from "@/lib/login-link";
import { emailChannel } from "@/lib/notify/email";
import { loginEmail } from "@/lib/notify/templates";
import { authClient, db } from "@/lib/supabase";
import { emailSchema } from "@/lib/validate";

const SENT = "If you're on the board, a login email is on its way. Check your inbox (and spam).";

/** After 5 wrong codes, the code stops working until a new email is sent. */
const MAX_CODE_TRIES = 5;

export type LoginState = { message: string; error?: boolean; email?: string } | null;

/**
 * B0. Always gives the same answer, so the form never reveals who is on the
 * board. The link is made here and sent through the club Gmail, so Supabase's
 * own (heavily rate-limited) mailer is never used.
 */
export async function sendLoginLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = emailSchema.safeParse(form.get("email"));
  if (!parsed.success) return { message: "That email doesn't look right.", error: true };
  const email = parsed.data;
  const supabase = db();

  const { data: member } = await supabase.from("board_members").select("id, last_login_link_at").eq("email", email).maybeSingle();
  if (!member) return { message: SENT, email };

  // One email a minute per person, so the form can't be used to flood an inbox.
  if (member.last_login_link_at && Date.now() - Date.parse(member.last_login_link_at) < 60_000) return { message: SENT, email };
  // A new moment kills the previous email's link and code (see lib/login-link.ts).
  const issuedAt = Date.now();
  await supabase.from("board_members").update({ last_login_link_at: new Date(issuedAt).toISOString(), login_code_attempts: 0 }).eq("id", member.id);

  try {
    await emailChannel().send({ to: email, ...loginEmail(loginUrl(email, issuedAt), env.siteUrl, loginCode(email, issuedAt)) });
  } catch (err) {
    console.error("Login email failed", err);
    return { message: "We couldn't send the email right now. Try again in a minute.", error: true };
  }
  return { message: SENT, email };
}

export type CodeState = { error: string } | null;

/**
 * The code from the login email. For the home-screen app, which keeps its
 * own login separate from the browser the email link opens in.
 */
export async function confirmCode(_prev: CodeState, form: FormData): Promise<CodeState> {
  const email = emailSchema.safeParse(form.get("email"));
  const code = String(form.get("code") ?? "");
  const wrong = { error: "That code didn't work. Check the latest email, or send a new one." };
  if (!email.success) return wrong;

  const supabase = db();
  const { data: member } = await supabase.from("board_members").select("id, last_login_link_at, login_code_attempts").eq("email", email.data).maybeSingle();
  if (!member?.last_login_link_at) return wrong;
  if (member.login_code_attempts >= MAX_CODE_TRIES) return { error: "Too many tries. Send yourself a new login email." };
  const issuedAt = Date.parse(member.last_login_link_at);
  if (!isCurrent(issuedAt, member.last_login_link_at)) return { error: "That code has expired. Send yourself a new login email." };
  await supabase.from("board_members").update({ login_code_attempts: member.login_code_attempts + 1 }).eq("id", member.id);

  if (!codeMatches(code, loginCode(email.data, issuedAt))) return wrong;
  if (!(await startSession(email.data))) return { error: "We couldn't log you in right now. Try again in a minute." };
  await supabase.from("board_members").update({ login_code_attempts: 0 }).eq("id", member.id);
  redirect("/admin");
}

export type ConfirmState = { error: string } | null;

/** Runs when the person presses the button, never on page load, because email scanners open links. */
export async function confirmLogin(_prev: ConfirmState, form: FormData): Promise<ConfirmState> {
  const tokenHash = String(form.get("token_hash") ?? "");
  if (!tokenHash) return { error: "This link is incomplete." };
  const supabase = await authClient();
  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (error) return { error: "This link has expired or was already used." };
  redirect("/admin");
}

export async function logOut() {
  const supabase = await authClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
