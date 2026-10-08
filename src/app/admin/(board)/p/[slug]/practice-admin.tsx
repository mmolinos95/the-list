"use client";

import { useState } from "react";
import { ConfirmButton, Flash, MoreMenu, Sheet, useAction } from "@/components/admin-ui";
import { Button, ButtonLink, Card, Check, Field, inputClass, Label, WaitRing, cx } from "@/components/ui";
import type { AdminList, AdminPractice, AdminSignup } from "@/lib/admin-data";
import { clock, dayDate } from "@/lib/time";
import { type ActionResult, addSignup, cancelPractice, editPractice, messagePractice, promoteSignup, removeSignup } from "../../../actions";
import { OpenSignupsButton } from "../../buttons";

type Form = { date: string; start: string; end: string; location: string };

const players = (n: number) => `${n} ${n === 1 ? "player" : "players"}`;

function recipients(lists: AdminList[], includeWaitlist: boolean) {
  const ids = new Set<string>();
  for (const l of lists) for (const s of [...l.main, ...(includeWaitlist ? l.waitlist : [])]) if (s.member.email) ids.add(s.member.id);
  return ids.size;
}

export function PracticeAdmin({ practice, lockTime, form }: { practice: AdminPractice; lockTime: string; form: Form }) {
  const { event, stage, lists } = practice;
  const [tab, setTab] = useState(lists[0]?.id);
  const [sheet, setSheet] = useState<null | "edit" | "message" | "cancel">(null);
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const list = lists.find((l) => l.id === tab) ?? lists[0];
  const locked = stage === "locked" || stage === "teams" || stage === "past";
  const live = stage !== "cancelled" && stage !== "past";
  const hasTeams = lists.some((l) => l.makes_teams);
  const teamsSent = lists.some((l) => l.makes_teams && l.teams_sent_at);

  return (
    <div className="mt-5 space-y-4">
      {live && (
        <div className="flex items-center gap-2">
          {stage === "waiting" ? (
            <OpenSignupsButton eventId={event.id} className="flex-1" />
          ) : hasTeams ? (
            <ButtonLink href={`/admin/p/${event.slug}/teams`} className="flex-1" kind={locked ? "primary" : "outline"}>
              {teamsSent ? "View teams" : "Build teams"}
            </ButtonLink>
          ) : (
            <div className="flex-1" />
          )}
          <MoreMenu
            items={[
              { label: "Edit this practice", onClick: () => setSheet("edit") },
              { label: "Message the list", onClick: () => setSheet("message") },
              { label: "Cancel practice", onClick: () => setSheet("cancel"), danger: true },
            ]}
          />
        </div>
      )}

      <Flash result={flash} onClose={() => setFlash(null)} />

      {lists.length > 1 && (
        <div className="flex gap-1 rounded-xl bg-white p-1" role="tablist">
          {lists.map((l) => (
            <button
              key={l.id}
              role="tab"
              aria-selected={l.id === list.id}
              onClick={() => setTab(l.id)}
              className={cx("flex-1 rounded-lg py-2 font-display text-xl", l.id === list.id ? "bg-columbia text-ink" : "text-muted hover:text-ink")}
            >
              {l.name} <span className="text-base">{l.main.length}/{l.cap}</span>
            </button>
          ))}
        </div>
      )}

      {list && <ListPanel key={list.id} list={list} locked={locked} live={live} lockTime={lockTime} onFlash={setFlash} />}

      <EditSheet open={sheet === "edit"} onClose={() => setSheet(null)} practice={practice} form={form} onFlash={setFlash} />
      <MessageSheet open={sheet === "message"} onClose={() => setSheet(null)} practice={practice} onFlash={setFlash} />
      <CancelSheet open={sheet === "cancel"} onClose={() => setSheet(null)} practice={practice} onFlash={setFlash} />
    </div>
  );
}

function ListPanel({
  list,
  locked,
  live,
  lockTime,
  onFlash,
}: {
  list: AdminList;
  locked: boolean;
  live: boolean;
  lockTime: string;
  onFlash: (r: ActionResult) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Card className="p-0">
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <Label>
            Main list · {list.main.length}/{list.cap}
          </Label>
          {live && (
            <button onClick={() => setAdding(true)} className="text-sm font-bold uppercase tracking-wide text-core hover:underline">
              + Add someone
            </button>
          )}
        </div>
        {list.main.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">Nobody yet. When members sign up, they show up here in order.</p>
        ) : (
          <ol>
            {list.main.map((s, i) => (
              <Row key={s.id} s={s} n={i + 1} kind="main" live={live} locked={locked} hasWaitlist={list.waitlist.length > 0} onFlash={onFlash} />
            ))}
          </ol>
        )}

        <div className="border-t border-line px-5 pb-2 pt-4">
          <Label>Waitlist · {list.waitlist.length}</Label>
          {live && list.waitlist.length > 0 && !locked && (
            <p className="mt-1 text-xs text-muted">Promotion is automatic until {lockTime}. After that, you choose who moves up.</p>
          )}
        </div>
        {list.waitlist.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">Nobody waiting.</p>
        ) : (
          <ol>
            {list.waitlist.map((s, i) => (
              <Row key={s.id} s={s} n={i + 1} kind="waitlist" live={live} locked={locked} hasWaitlist onFlash={onFlash} />
            ))}
          </ol>
        )}

        {list.gone.length > 0 && (
          <details className="border-t border-line px-5 py-4">
            <summary className="cursor-pointer text-sm font-semibold">Dropped ({list.gone.length})</summary>
            <ul className="mt-3 space-y-2 text-sm">
              {list.gone.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3">
                  <span>{s.member.name}</span>
                  <span className={cx("text-right text-xs", s.dropped_late ? "font-semibold text-kickoff" : "text-muted")}>
                    {s.status === "removed" ? "Removed by the board" : s.dropped_late ? "Late drop" : "Dropped"} ·{" "}
                    {dayDate(s.dropped_at ?? s.removed_at!)} {clock(s.dropped_at ?? s.removed_at!)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
      <AddSheet open={adding} onClose={() => setAdding(false)} list={list} onFlash={onFlash} />
    </>
  );
}

function Row({
  s,
  n,
  kind,
  live,
  locked,
  hasWaitlist,
  onFlash,
}: {
  s: AdminSignup;
  n: number;
  kind: "main" | "waitlist";
  live: boolean;
  locked: boolean;
  hasWaitlist: boolean;
  onFlash: (r: ActionResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const first = s.member.name.split(" ")[0];
  return (
    <li className="border-t border-line/60 first:border-t-0">
      <div className="flex items-center gap-3 px-5 py-2.5">
        <span className="w-6 text-right font-display text-xl text-muted tabular-nums">{n}</span>
        {kind === "main" ? <Check /> : <WaitRing />}
        <button onClick={() => setOpen(!open)} className="flex-1 text-left text-[15px] font-medium" aria-expanded={open}>
          {s.member.name}
          {s.added_by && <span className="ml-2 text-xs text-muted">added by board</span>}
          {s.promoted_by && <span className="ml-2 text-xs text-muted">promoted</span>}
        </button>
        {kind === "waitlist" && live && locked && (
          <ConfirmButton
            label="Promote"
            kind={n === 1 ? "primary" : "outline"}
            className="h-9 px-3 text-lg"
            title={`Promote ${first}?`}
            body={
              <>
                {s.member.name} moves to the main list{n > 1 ? `, ahead of ${n - 1} ${n === 2 ? "person" : "people"} waiting longer` : ""}.{" "}
                {s.member.email ? "They'll get an email." : "They have no email on file, so tell them yourself."}
              </>
            }
            confirm="Promote"
            action={() => promoteSignup(s.id)}
            onDone={onFlash}
          />
        )}
      </div>
      {open && (
        <div className="space-y-1 bg-page px-5 py-3 pl-[4.25rem] text-sm">
          <p>{s.member.email ? <a href={`mailto:${s.member.email}`} className="text-core underline">{s.member.email}</a> : <span className="text-muted">No email</span>}</p>
          <p>{s.member.phone ? <a href={`tel:${s.member.phone}`} className="text-core underline">{s.member.phone}</a> : <span className="text-muted">No phone</span>}</p>
          <p className="text-muted">
            Signed up {dayDate(s.created_at)} at {clock(s.created_at)}
            {s.promoted_at && ` · moved up ${dayDate(s.promoted_at)} at ${clock(s.promoted_at)}`}
          </p>
          {live && (
            <ConfirmButton
              label="Remove from list"
              kind="ghost"
              confirmKind="danger"
              className="-ml-5 mt-1 h-9 text-lg text-kickoff"
              title={`Remove ${first}?`}
              body={
                <>
                  Use this for duplicates, fake names, or someone who told you they can&apos;t come. They won&apos;t get an email.
                  {kind === "main" && hasWaitlist && !locked && " The first person on the waitlist moves up and gets an email."}
                  {kind === "main" && hasWaitlist && locked && " The list is locked, so nobody moves up automatically. You can promote someone after."}
                </>
              }
              confirm="Remove"
              action={() => removeSignup(s.id)}
              onDone={onFlash}
            />
          )}
        </div>
      )}
    </li>
  );
}

function AddSheet({ open, onClose, list, onFlash }: { open: boolean; onClose: () => void; list: AdminList; onFlash: (r: ActionResult) => void }) {
  const { pending, result, run, clear } = useAction();
  const [spot, setSpot] = useState<"main" | "waitlist">("waitlist");
  const full = list.main.length >= list.cap;
  return (
    <Sheet
      open={open}
      onClose={() => {
        clear();
        onClose();
      }}
      title={`Add to ${list.name}`}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const form = e.currentTarget;
          run(
            () =>
              addSignup({
                listId: list.id,
                name: String(f.get("name")),
                email: String(f.get("email")),
                phone: String(f.get("phone")),
                country: "US",
                spot,
              }),
            (r) => {
              form.reset();
              onFlash(r);
              onClose();
            },
          );
        }}
      >
        <Field label="Full name">
          <input name="name" required className={inputClass} autoComplete="off" />
        </Field>
        <Field label="Email (optional)" hint="With an email, they get a confirmation and a drop-out link.">
          <input name="email" type="email" className={inputClass} autoComplete="off" />
        </Field>
        <Field label="Phone (optional)" hint="US numbers as is. Others with + and the country code.">
          <input name="phone" type="tel" className={inputClass} autoComplete="off" />
        </Field>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold">Where</legend>
          <label className="flex items-center gap-2 text-[15px]">
            <input type="radio" checked={spot === "waitlist"} onChange={() => setSpot("waitlist")} className="size-4 accent-core" />
            End of the waitlist{!full && " (they move up right away if there's room)"}
          </label>
          <label className="flex items-center gap-2 text-[15px]">
            <input type="radio" checked={spot === "main"} onChange={() => setSpot("main")} className="size-4 accent-core" />
            Main list{full && `, over the cap (${list.main.length + 1}/${list.cap})`}
          </label>
        </fieldset>
        {result && !result.ok && <Flash result={result} />}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Adding…" : "Add to list"}
        </Button>
      </form>
    </Sheet>
  );
}

function EditSheet({
  open,
  onClose,
  practice,
  form,
  onFlash,
}: {
  open: boolean;
  onClose: () => void;
  practice: AdminPractice;
  form: Form;
  onFlash: (r: ActionResult) => void;
}) {
  const { pending, result, run, clear } = useAction();
  const [v, setV] = useState(form);
  const [caps, setCaps] = useState(() => Object.fromEntries(practice.lists.map((l) => [l.id, String(l.cap)])));
  const [notifyTouched, setNotifyTouched] = useState(false);
  const [notifyChoice, setNotifyChoice] = useState(false);
  const moved = v.date !== form.date || v.start !== form.start || v.end !== form.end || v.location.trim() !== form.location;
  const notify = notifyTouched ? notifyChoice : moved;
  const n = recipients(practice.lists, true);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  return (
    <Sheet
      open={open}
      onClose={() => {
        clear();
        onClose();
      }}
      title="Edit this practice"
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () =>
              editPractice({
                eventId: practice.event.id,
                ...v,
                caps: practice.lists.map((l) => ({ listId: l.id, cap: Number(caps[l.id]) })),
                notify,
              }),
            (r) => {
              onFlash(r);
              onClose();
            },
          );
        }}
      >
        <p className="text-sm text-muted">Changes apply to this practice only. To change every week, edit the weekly schedule.</p>
        <Field label="Date">
          <input type="date" required value={v.date} onChange={set("date")} className={inputClass} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">
            <input type="time" required value={v.start} onChange={set("start")} className={inputClass} />
          </Field>
          <Field label="Ends">
            <input type="time" required value={v.end} onChange={set("end")} className={inputClass} />
          </Field>
        </div>
        <Field label="Place">
          <input required value={v.location} onChange={set("location")} className={inputClass} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {practice.lists.map((l) => (
            <Field key={l.id} label={`${l.name} cap`}>
              <input
                type="number"
                min={1}
                max={500}
                required
                value={caps[l.id]}
                onChange={(e) => setCaps({ ...caps, [l.id]: e.target.value })}
                className={inputClass}
              />
            </Field>
          ))}
        </div>
        <p className="text-xs text-muted">
          Raising a cap before the lock moves people up from the waitlist (they get an email). Lowering it never removes anyone already in.
        </p>
        <label className="flex items-start gap-2 text-[15px]">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => {
              setNotifyTouched(true);
              setNotifyChoice(e.target.checked);
            }}
            className="mt-1 size-4 accent-core"
          />
          <span>
            Email everyone on the list about this change <span className="text-muted">({players(n)})</span>
          </span>
        </label>
        {result && !result.ok && <Flash result={result} />}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Saving…" : notify && n > 0 ? `Save and email ${players(n)}` : "Save"}
        </Button>
      </form>
    </Sheet>
  );
}

function MessageSheet({ open, onClose, practice, onFlash }: { open: boolean; onClose: () => void; practice: AdminPractice; onFlash: (r: ActionResult) => void }) {
  const { pending, result, run, clear } = useAction();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [waitlist, setWaitlist] = useState(false);
  const n = recipients(practice.lists, waitlist);
  return (
    <Sheet
      open={open}
      onClose={() => {
        clear();
        onClose();
      }}
      title="Message the list"
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => messagePractice(practice.event.id, subject, body, waitlist),
            (r) => {
              setSubject("");
              setBody("");
              onFlash(r);
              onClose();
            },
          );
        }}
      >
        <Field label="Subject">
          <input required value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} placeholder="Bring both shirts today" maxLength={120} />
        </Field>
        <Field label="Message">
          <textarea
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            className={cx(inputClass, "h-auto py-2")}
            placeholder="We're on the north field today because of the event on the main pitch."
          />
        </Field>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold">Send to</legend>
          <label className="flex items-center gap-2 text-[15px]">
            <input type="checkbox" checked disabled className="size-4 accent-core" /> Main list
          </label>
          <label className="flex items-center gap-2 text-[15px]">
            <input type="checkbox" checked={waitlist} onChange={(e) => setWaitlist(e.target.checked)} className="size-4 accent-core" /> Waitlist
          </label>
        </fieldset>
        <p className="text-xs text-muted">It goes out as a branded email signed with your name, with each player&apos;s drop-out link at the bottom.</p>
        {result && !result.ok && <Flash result={result} />}
        <Button type="submit" disabled={pending || n === 0} className="w-full">
          {pending ? "Sending…" : n === 0 ? "Nobody to email yet" : `Send to ${players(n)}`}
        </Button>
      </form>
    </Sheet>
  );
}

function CancelSheet({ open, onClose, practice, onFlash }: { open: boolean; onClose: () => void; practice: AdminPractice; onFlash: (r: ActionResult) => void }) {
  const { pending, result, run, clear } = useAction();
  const [reason, setReason] = useState("");
  const n = recipients(practice.lists, true);
  return (
    <Sheet
      open={open}
      onClose={() => {
        clear();
        onClose();
      }}
      title="Cancel practice?"
    >
      <div className="space-y-4">
        <Field label="Reason (optional)" hint="Shown on the practice page and in the email.">
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} placeholder="Field closed for rain" maxLength={300} />
        </Field>
        <p className="text-[15px]">
          {n > 0 ? `We'll email the ${players(n)} signed up, including the waitlist.` : "Nobody has signed up yet, so no emails go out."}{" "}
          <b>This can&apos;t be undone.</b>
        </p>
        {result && !result.ok && <Flash result={result} />}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            kind="danger"
            disabled={pending}
            className="flex-1"
            onClick={() =>
              run(
                () => cancelPractice(practice.event.id, reason),
                (r) => {
                  onFlash(r);
                  onClose();
                },
              )
            }
          >
            {pending ? "Cancelling…" : "Cancel practice"}
          </Button>
          <Button kind="ghost" className="flex-1" onClick={onClose}>
            Keep it
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

