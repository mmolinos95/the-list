"use server";

import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { emailChannel } from "@/lib/notify/email";
import { loginEmail } from "@/lib/notify/templates";
import { authClient, db } from "@/lib/supabase";
import { emailSchema } from "@/lib/validate";

const SENT = "If you're on the board, a login link is on its way. Check your inbox (and spam).";

export type LoginState = { message: string; error?: boolean } | null;

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
  if (!member) return { message: SENT };

  // One link a minute per person, so the form can't be used to flood an inbox.
  if (member.last_login_link_at && Date.now() - Date.parse(member.last_login_link_at) < 60_000) return { message: SENT };
  await supabase.from("board_members").update({ last_login_link_at: new Date().toISOString() }).eq("id", member.id);

  let link = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) {
    // No auth account yet (first login): create one, then try again.
    await supabase.auth.admin.createUser({ email, email_confirm: true });
    link = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  }
  if (link.error || !link.data.properties?.hashed_token) {
    console.error("Login link failed", link.error);
    return { message: "We couldn't make a login link right now. Try again in a minute.", error: true };
  }

  const url = `${env.siteUrl}/admin/auth/confirm?token_hash=${encodeURIComponent(link.data.properties.hashed_token)}`;
  try {
    await emailChannel().send({ to: email, ...loginEmail(url, env.siteUrl) });
  } catch (err) {
    console.error("Login email failed", err);
    return { message: "We couldn't send the email right now. Try again in a minute.", error: true };
  }
  return { message: SENT };
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
