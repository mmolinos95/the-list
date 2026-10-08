"use client";

import { useActionState } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { confirmCode, sendLoginLink, type CodeState, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendLoginLink, null);
  const sentTo = state && !state.error ? state.email : undefined;
  return (
    <>
      <form action={action} className="mt-5 space-y-4">
        <Field label="Your email">
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            className={inputClass}
            placeholder="you@example.com"
            defaultValue={state?.email}
          />
        </Field>
        <Button type="submit" kind={sentTo ? "outline" : "primary"} disabled={pending} className="w-full">
          {pending ? "Sending…" : sentTo ? "Send a new email" : "Send me a login link"}
        </Button>
        {state && <p className={state.error ? "text-sm font-semibold text-kickoff" : "rounded-lg bg-columbia-50 p-3 text-sm"}>{state.message}</p>}
      </form>
      {sentTo && <CodeForm email={sentTo} />}
    </>
  );
}

/** Second way in: the code from the same email. Works in the home-screen app. */
function CodeForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<CodeState, FormData>(confirmCode, null);
  return (
    <form action={action} className="mt-6 space-y-4 border-t border-line pt-5">
      <input type="hidden" name="email" value={email} />
      <Field label="Or type the code from the email" hint="Handy in the home-screen app, or when the email is on another device.">
        <input
          name="code"
          required
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9 ]{6,12}"
          maxLength={12}
          className={`${inputClass} text-center font-display text-3xl tracking-[0.3em]`}
          placeholder="1234 5678"
        />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Checking…" : "Log in"}
      </Button>
      {state?.error && <p className="text-sm font-semibold text-kickoff">{state.error}</p>}
    </form>
  );
}
