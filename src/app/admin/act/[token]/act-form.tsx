"use client";

import { useState, useTransition } from "react";
import { CancelReason } from "@/components/cancel-reason";
import { Button, ButtonLink, Card, Label } from "@/components/ui";
import { actCancel, actPromote, type ActResult } from "../actions";

function Done({ result, practiceHref }: { result: Extract<ActResult, { ok: true }>; practiceHref: string }) {
  return (
    <Card>
      <p className="font-display text-4xl leading-none">Done</p>
      <p className="mt-3">{result.message}</p>
      <ButtonLink href={practiceHref} kind="outline" className="mt-5">
        Open the practice
      </ButtonLink>
    </Card>
  );
}

export function PromoteForm(props: {
  token: string;
  signupId: string;
  name: string;
  list: string;
  count: string;
  waiting: number;
  title: string;
  when: string;
  practiceHref: string;
}) {
  const [result, setResult] = useState<ActResult | null>(null);
  const [pending, start] = useTransition();
  if (result?.ok) return <Done result={result} practiceHref={props.practiceHref} />;
  return (
    <Card>
      <Label>
        {props.title} · {props.list} {props.count}
      </Label>
      <p className="mt-2 font-display text-4xl leading-none">Move {props.name} up?</p>
      <p className="mt-2 text-sm text-muted">{props.when}</p>
      <p className="mt-4">
        {props.name} is next on the {props.list} waitlist{props.waiting > 1 ? ` (${props.waiting} waiting)` : ""}. They&apos;ll get a spot and an email saying
        so.
      </p>
      {result && !result.ok && <p className="mt-3 text-sm font-semibold text-kickoff">{result.error}</p>}
      <Button className="mt-5 w-full" disabled={pending} onClick={() => start(async () => setResult(await actPromote(props.token, props.signupId)))}>
        {pending ? "Promoting…" : `Promote ${props.name}`}
      </Button>
      <ButtonLink href={props.practiceHref} kind="ghost" className="mt-2 w-full">
        Open the practice instead
      </ButtonLink>
    </Card>
  );
}

export function CancelForm(props: { token: string; title: string; when: string; emailCount: number; practiceHref: string }) {
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActResult | null>(null);
  const [pending, start] = useTransition();
  if (result?.ok) return <Done result={result} practiceHref={props.practiceHref} />;
  const n = props.emailCount;
  return (
    <Card>
      <p className="font-display text-4xl leading-none">Cancel {props.title}?</p>
      <p className="mt-2 text-sm text-muted">{props.when}</p>
      <div className="mt-5">
        <CancelReason value={reason} onChange={setReason} />
      </div>
      <p className="mt-4 text-[15px]">
        {n > 0 ? `We'll email the ${n} ${n === 1 ? "player" : "players"} signed up, including the waitlist.` : "Nobody has signed up yet, so no emails go out."}{" "}
        <b>This can&apos;t be undone.</b>
      </p>
      {result && !result.ok && <p className="mt-3 text-sm font-semibold text-kickoff">{result.error}</p>}
      <Button kind="danger" className="mt-5 w-full" disabled={pending} onClick={() => start(async () => setResult(await actCancel(props.token, reason)))}>
        {pending ? "Cancelling…" : "Cancel practice"}
      </Button>
      <ButtonLink href={props.practiceHref} kind="ghost" className="mt-2 w-full">
        Keep it
      </ButtonLink>
    </Card>
  );
}
