"use client";

import { useSearchParams } from "next/navigation";

// Shown when a login link from the email didn't work (see auth/link/[token]).
const NOTICE: Record<string, string> = {
  expired: "That login link has expired or a newer one was sent. Send yourself a new one below.",
  bad: "That login link is incomplete. Send yourself a new one below.",
  failed: "We couldn't log you in just now. Send yourself a new link below.",
};

export function LinkNotice() {
  const reason = useSearchParams().get("link");
  const text = reason ? NOTICE[reason] : undefined;
  return text ? <p className="mt-4 rounded-lg bg-kickoff/10 p-3 text-sm font-semibold text-kickoff">{text}</p> : null;
}
