import type { Metadata } from "next";
import { Suspense } from "react";
import { getTemplates } from "@/lib/admin-data";
import { requireBoard } from "@/lib/auth";
import { ScheduleEditor } from "./schedule-editor";

// B7: the recurring practices. Presidents edit; board members can look.

export const metadata: Metadata = { title: "Weekly schedule" };

export default function SchedulePage() {
  return (
    <>
      <h1 className="font-display text-4xl">Weekly schedule</h1>
      <p className="mb-4 mt-1 text-[15px] text-muted">
        Practices are created from this schedule automatically, two weeks ahead. Lists lock 2 hours before kickoff.
      </p>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-white/70" />}>
        <Schedule />
      </Suspense>
    </>
  );
}

async function Schedule() {
  const me = await requireBoard();
  const templates = await getTemplates();
  return <ScheduleEditor templates={templates} canEdit={me.role === "president"} />;
}
