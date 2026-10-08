"use client";

import { ConfirmButton, Flash, useAction } from "@/components/admin-ui";
import { Button } from "@/components/ui";
import { openSignups, retryFailedEmails } from "../actions";

export function OpenSignupsButton({ eventId, className = "" }: { eventId: string; className?: string }) {
  return (
    <ConfirmButton
      label="Open sign-ups"
      title="Open sign-ups now?"
      body="Members can sign up from the link right away. Post it in the WhatsApp group so people know."
      confirm="Open sign-ups"
      className={className}
      action={() => openSignups(eventId)}
    />
  );
}

export function RetryEmailsButton({ count }: { count: number }) {
  const { pending, result, run } = useAction();
  if (result?.ok) return <Flash result={result} />;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-kickoff bg-white p-4">
      <p className="text-sm">
        <b className="text-kickoff">
          {count} {count === 1 ? "email" : "emails"} couldn&apos;t be sent.
        </b>{" "}
        Usually Gmail is busy or over its daily limit.
      </p>
      <Button kind="outline" disabled={pending} onClick={() => run(retryFailedEmails)}>
        {pending ? "Retrying…" : "Retry"}
      </Button>
      {result && !result.ok && <Flash result={result} />}
    </div>
  );
}
