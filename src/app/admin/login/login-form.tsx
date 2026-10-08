"use client";

import { useActionState } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { sendLoginLink, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendLoginLink, null);
  return (
    <form action={action} className="mt-5 space-y-4">
      <Field label="Your email">
        <input name="email" type="email" required autoComplete="email" inputMode="email" className={inputClass} placeholder="you@example.com" />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Send me a login link"}
      </Button>
      {state && <p className={state.error ? "text-sm font-semibold text-kickoff" : "rounded-lg bg-columbia-50 p-3 text-sm"}>{state.message}</p>}
    </form>
  );
}
