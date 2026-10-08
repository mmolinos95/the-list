"use server";

import { redirect } from "next/navigation";
import { env } from "@/lib/env";
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

  // One link a minute per person, so the form can't be used to flood an inbox.
  if (member.last_login_link_at && Date.now() - Date.parse(member.last_login_link_at) < 60_000) return { message: SENT, email };
  await supabase.from("board_members").update({ last_login_link_at: new Date().toISOString(), login_code_attempts: 0 }).eq("id", member.id);

  let link = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  const user = link.data?.user;
  if (link.error || !user?.email_confirmed_at) {
    // First login: generateLink makes an unconfirmed account and returns a
    // signup token, which verifyOtp({ type: "magiclink" }) rejects. Confirm the
    // account (board_members already vouches for the email), then make a real link.
    if (user) await supabase.auth.admin.updateUserById(user.id, { email_confirm: true });
    else await supabase.auth.admin.createUser({ email, email_confirm: true });
    link = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  }
  if (link.error || !link.data.properties?.hashed_token) {
    console.error("Login link failed", link.error);
    return { message: "We couldn't make a login link right now. Try again in a minute.", error: true };
  }

  const url = `${env.siteUrl}/admin/auth/confirm?token_hash=${encodeURIComponent(link.data.properties.hashed_token)}`;
  try {
    await emailChannel().send({ to: email, ...loginEmail(url, env.siteUrl, link.data.properties.email_otp) });
  } catch (err) {
    console.error("Login email failed", err);
    return { message: "We couldn't send the email right now. Try again in a minute.", error: true };
  }
  return { message: SENT, email };
}

export type CodeState = { error: string } | null;

/**
 * The code from the login email. For the home-screen app, which keeps
 * its own login separate from the browser the email link opens in.
 */
export async function confirmCode(_prev: CodeState, form: FormData): Promise<CodeState> {
  const email = emailSchema.safeParse(form.get("email"));
  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  const wrong = { error: "That code didn't work. Check the latest email, or send a new one." };
  // Supabase sets the length (6 to 10 digits; this project uses 8).
  if (!email.success || code.length < 6 || code.length > 10) return wrong;

  const supabase = db();
  const { data: member } = await supabase.from("board_members").select("id, login_code_attempts").eq("email", email.data).maybeSingle();
  if (!member) return wrong;
  if (member.login_code_attempts >= MAX_CODE_TRIES) return { error: "Too many tries. Send yourself a new login email." };
  await supabase.from("board_members").update({ login_code_attempts: member.login_code_attempts + 1 }).eq("id", member.id);

  const { error } = await (await authClient()).auth.verifyOtp({ type: "email", email: email.data, token: code });
  if (error) return wrong;
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
