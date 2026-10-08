import type { Metadata } from "next";
import { Suspense } from "react";
import { getBoardMembers } from "@/lib/admin-data";
import { requireBoard } from "@/lib/auth";
import { BoardAdmin } from "./board-admin";

// B9: who has access, and the yearly handover.

export const metadata: Metadata = { title: "Board" };

export default function BoardPage() {
  return (
    <>
      <h1 className="mb-4 font-display text-4xl">Board</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-white/70" />}>
        <Board />
      </Suspense>
    </>
  );
}

async function Board() {
  const me = await requireBoard();
  const members = await getBoardMembers();
  return <BoardAdmin me={me} members={members} />;
}
