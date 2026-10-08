"use client";

import { useState } from "react";
import { ConfirmButton, Flash, useAction } from "@/components/admin-ui";
import { Button, Card, Chip, Field, inputClass, Label } from "@/components/ui";
import type { BoardMember, BoardRole } from "@/lib/types";
import { type ActionResult, inviteBoard, removeBoard, setBoardRole, setMyName } from "../../actions";

export function BoardAdmin({ me, members }: { me: BoardMember; members: BoardMember[] }) {
  const isPresident = me.role === "president";
  const presidents = members.filter((m) => m.role === "president").length;
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const roleAction = useAction();

  return (
    <div className="space-y-4">
      <Flash result={flash ?? roleAction.result} onClose={() => (setFlash(null), roleAction.clear())} />

      <NameCard me={me} />

      {isPresident && (
        <p className="rounded-xl bg-columbia-50 p-3 text-sm">
          <b>New board?</b> Invite them, make the new presidents presidents, then remove yourselves.
        </p>
      )}

      <Card className="p-0">
        <div className="px-5 pb-2 pt-4">
          <Label>Everyone with access · {members.length}</Label>
        </div>
        <ul>
          {members.map((m) => {
            const lastPresident = m.role === "president" && presidents === 1;
            const isMe = m.id === me.id;
            return (
              <li key={m.id} className="border-t border-line/60 px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {m.name || m.email}
                      {isMe && <span className="ml-1 font-normal text-muted">(you)</span>}
                    </p>
                    {m.name && <p className="truncate text-sm text-muted">{m.email}</p>}
                    {!m.user_id && <p className="text-xs text-muted">Hasn&apos;t logged in yet</p>}
                  </div>
                  <Chip kind={m.role === "president" ? "core" : "neutral"}>{m.role === "president" ? "President" : "Board"}</Chip>
                </div>
                {(isPresident || isMe) && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    {isPresident && (
                      <button
                        className="font-semibold text-core hover:underline disabled:text-muted disabled:no-underline"
                        disabled={roleAction.pending || lastPresident}
                        onClick={() => roleAction.run(() => setBoardRole(m.id, m.role === "president" ? "board" : "president"))}
                      >
                        {m.role === "president" ? "Make board member" : "Make president"}
                      </button>
                    )}
                    {lastPresident ? (
                      <span className="text-xs text-muted">The club needs at least one president.</span>
                    ) : (
                      <ConfirmButton
                        label={isMe ? "Leave the board" : "Remove"}
                        kind="ghost"
                        confirmKind="danger"
                        className="h-8 px-0 text-base text-kickoff"
                        title={isMe ? "Leave the board?" : `Remove ${m.name || m.email}?`}
                        body={isMe ? "You'll be logged out and won't be able to log back in unless a president invites you again." : "They won't be able to log in anymore. You can invite them again later."}
                        confirm={isMe ? "Leave" : "Remove"}
                        action={() => removeBoard(m.id)}
                        onDone={setFlash}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {isPresident && <InviteCard onDone={setFlash} />}
    </div>
  );
}

function NameCard({ me }: { me: BoardMember }) {
  const [name, setName] = useState(me.name);
  const { pending, result, run } = useAction();
  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => setMyName(name));
        }}
      >
        <Field label="Your name" hint="Shown when you message the list.">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Your full name" maxLength={80} />
        </Field>
        <Button type="submit" kind="outline" className="h-10 text-lg" disabled={pending || name.trim() === me.name}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Flash result={result} />
      </form>
    </Card>
  );
}

function InviteCard({ onDone }: { onDone: (r: ActionResult) => void }) {
  const [role, setRole] = useState<BoardRole>("board");
  const { pending, result, run } = useAction();
  return (
    <Card>
      <h2 className="font-display text-3xl">Invite</h2>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const form = e.currentTarget;
          run(
            () => inviteBoard(String(f.get("name")), String(f.get("email")), role),
            (r) => {
              form.reset();
              setRole("board");
              onDone(r);
            },
          );
        }}
      >
        <Field label="Name">
          <input name="name" className={inputClass} autoComplete="off" />
        </Field>
        <Field label="Email" hint="They log in with this address. We email them how.">
          <input name="email" type="email" required className={inputClass} autoComplete="off" />
        </Field>
        <fieldset className="space-y-2 text-[15px]">
          <legend className="mb-1 text-sm font-semibold">Role</legend>
          <label className="flex items-start gap-2">
            <input type="radio" checked={role === "board"} onChange={() => setRole("board")} className="mt-1 size-4 accent-core" />
            <span>
              <b>Board member</b>: runs practices, lists and teams
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" checked={role === "president"} onChange={() => setRole("president")} className="mt-1 size-4 accent-core" />
            <span>
              <b>President</b>: also edits the weekly schedule and manages the board
            </span>
          </label>
        </fieldset>
        {result && !result.ok && <Flash result={result} />}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Inviting…" : "Send invite"}
        </Button>
      </form>
    </Card>
  );
}
