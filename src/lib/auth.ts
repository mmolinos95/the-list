import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { authClient, db } from "./supabase";
import type { BoardMember } from "./types";

// Board access. Supabase Auth proves who someone is (by email); the
// board_members table decides whether they get in and with which role.
// Removing someone from board_members locks them out on their next request.

/** The board member behind this request, or null. Cached per request. */
export const getBoard = cache(async (): Promise<BoardMember | null> => {
  const supabase = await authClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase();
  if (!user || !email) return null;

  const { data } = await db().from("board_members").select("*").eq("email", email).maybeSingle();
  if (!data) return null;
  const member = data as BoardMember;
  if (member.user_id !== user.id) {
    // First login (or a new auth account for the same email): link them.
    await db().from("board_members").update({ user_id: user.id }).eq("id", member.id);
    member.user_id = user.id;
  }
  return member;
});

/** For pages: sends anyone who isn't on the board to the login page. */
export async function requireBoard(): Promise<BoardMember> {
  const me = await getBoard();
  if (!me) redirect("/admin/login");
  return me;
}

export class NotAllowed extends Error {}

/** For server actions: throws instead of redirecting. */
export async function boardOnly(): Promise<BoardMember> {
  const me = await getBoard();
  if (!me) throw new NotAllowed("Your login has expired. Log in again.");
  return me;
}

export async function presidentOnly(): Promise<BoardMember> {
  const me = await boardOnly();
  if (me.role !== "president") throw new NotAllowed("Only presidents can do that.");
  return me;
}
