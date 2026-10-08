"use client";

import { ConfirmButton, Flash, useAction } from "@/components/admin-ui";
import { useState } from "react";
import { Button, buttonClass, type ButtonKind } from "@/components/ui";
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

/** Copies `text` and says so for a moment. Falls back to a prompt where the clipboard is blocked. */
export function CopyButton({ text, label, kind = "outline", className = "" }: { text: string; label: string; kind?: ButtonKind; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      kind={kind}
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this:", text);
        }
      }}
    >
      {copied ? "Copied ✓" : label}
    </Button>
  );
}

/** Opens WhatsApp (the app on phones, WhatsApp Web on computers) with the post ready to send. */
export function WhatsAppButton({ href, label = "Share to WhatsApp", kind = "primary", className = "" }: { href: string; label?: string; kind?: ButtonKind; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClass(kind, className)}>
      {label}
    </a>
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
