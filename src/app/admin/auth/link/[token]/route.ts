import { redirect } from "next/navigation";
import { isCurrent, readLoginToken, startSession } from "@/lib/login-link";
import { db } from "@/lib/supabase";

// The link in the login email: one tap logs you in. It stays valid for 15
// minutes rather than being single-use, because email scanners open links
// before you do (see lib/login-link.ts).

export async function GET(_request: Request, { params }: RouteContext<"/admin/auth/link/[token]">) {
  const link = readLoginToken((await params).token);
  if (!link) redirect("/admin/login?link=bad");

  const { data: member } = await db().from("board_members").select("last_login_link_at").eq("email", link.email.toLowerCase()).maybeSingle();
  if (!member || !isCurrent(link.issuedAt, member.last_login_link_at)) redirect("/admin/login?link=expired");

  if (!(await startSession(link.email))) redirect("/admin/login?link=failed");
  redirect("/admin");
}
