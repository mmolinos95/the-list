"use client";

import { useState, useTransition } from "react";
import { dropOut } from "@/app/actions";
import { Button, ButtonLink, Card, Check, WaitRing, cx } from "@/components/ui";
import type { MySpot } from "@/lib/data";

export function DropForm(props: {
  token: string;
  firstName: string;
  title: string;
  when: string;
  slug: string;
  locked: boolean;
  lockTime: string;
  spots: MySpot[];
}) {
  const { spots, locked } = props;
  const [picked, setPicked] = useState(new Set(spots.map((s) => s.listId)));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[] | null>(null);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <Card>
        <p className="font-display text-4xl leading-none">You&apos;re off the list</p>
        <p className="mt-3">
          You dropped out of {done.join(" and ")} for {props.title.toLowerCase()}. Thanks for freeing up the spot{props.firstName ? `, ${props.firstName}` : ""}.
        </p>
        <p className="mt-2 text-sm text-muted">Changed your mind? Sign up again. You&apos;ll join the end of the list.</p>
        <ButtonLink href={`/p/${props.slug}`} kind="outline" className="mt-5">
          Back to the practice
        </ButtonLink>
      </Card>
    );
  }

  const willDropMain = spots.some((s) => s.spot === "main" && picked.has(s.listId));

  return (
    <Card>
      <p className="font-display text-4xl leading-none">Drop out of {props.title.toLowerCase()}?</p>
      <p className="mt-2 text-muted">{props.when}</p>

      <ul className="mt-5 space-y-2">
        {spots.map((s) => {
          const on = picked.has(s.listId);
          return (
            <li key={s.listId}>
              <label className={cx("flex cursor-pointer items-center gap-3 rounded-xl border-2 px-3 py-3", on ? "border-kickoff bg-kickoff/5" : "border-line")}>
                <input
                  type="checkbox"
                  className="size-4 accent-kickoff"
                  checked={on}
                  onChange={() => {
                    const next = new Set(picked);
                    if (on) next.delete(s.listId);
                    else next.add(s.listId);
                    setPicked(next);
                  }}
                />
                {s.spot === "main" ? <Check /> : <WaitRing />}
                <span className="flex-1">
                  <span className="font-display text-xl">{s.list}</span>{" "}
                  <span className="text-sm text-muted">{s.spot === "main" ? `#${s.position} of ${s.cap}` : `#${s.position} on the waitlist`}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-sm">
        {locked && willDropMain
          ? `The list locked at ${props.lockTime}, so your spot won't be refilled automatically. We'll let the board know so they can sort it out.`
          : willDropMain
            ? "Your spot goes to the next teammate on the waitlist."
            : "You'll leave the waitlist."}
      </p>

      {error && <p className="mt-3 text-sm font-semibold text-kickoff">{error}</p>}

      <Button
        kind="danger"
        className="mt-5 w-full"
        disabled={pending || picked.size === 0}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await dropOut(props.token, [...picked]);
            if (res.ok) setDone(res.dropped);
            else setError(res.error);
          })
        }
      >
        {pending ? "Dropping…" : "Drop out"}
      </Button>
      <ButtonLink href={`/p/${props.slug}`} kind="ghost" className="mt-2 w-full">
        Keep my spot
      </ButtonLink>
    </Card>
  );
}
