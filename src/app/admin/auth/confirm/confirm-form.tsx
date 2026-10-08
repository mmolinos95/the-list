"use client";

import { useActionState } from "react";
import { Button, ButtonLink } from "@/components/ui";
import { confirmLogin, type ConfirmState } from "../../login/actions";

export function ConfirmForm({ tokenHash }: { tokenHash: string }) {
  const [state, action, pending] = useActionState<ConfirmState, FormData>(confirmLogin, null);
  if (state?.error) {
    return (
      <div className="mt-5 space-y-4">
        <p className="text-sm font-semibold text-kickoff">{state.error}</p>
        <ButtonLink href="/admin/login" className="w-full">
          Get a new link
        </ButtonLink>
      </div>
    );
  }
  return (
    <form action={action} className="mt-5">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Logging in…" : "Log in to The List"}
      </Button>
    </form>
  );
}
