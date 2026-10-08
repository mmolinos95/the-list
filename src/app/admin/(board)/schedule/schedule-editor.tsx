"use client";

import { useState } from "react";
import { ConfirmButton, Flash, Sheet, useAction } from "@/components/admin-ui";
import { Button, Card, Chip, cx, inputClass } from "@/components/ui";
import { timeOfDay, WEEKDAYS } from "@/lib/time";
import type { Template } from "@/lib/types";
import { type ActionResult, deleteTemplate, saveTemplate, setTemplatePaused, type TemplateInput } from "../../actions";

const hhmm = (t: string) => t.slice(0, 5);
const short = (d: number) => WEEKDAYS[((d % 7) + 7) % 7].slice(0, 3);

function opensLine(t: Pick<Template, "open_mode" | "weekday" | "open_days_before" | "open_time">) {
  if (t.open_mode === "manual") return "Opens when a board member presses “Open sign-ups”";
  const day = t.open_days_before === 0 ? "same day" : short(t.weekday - t.open_days_before);
  return `Opens ${day} ${timeOfDay(t.open_time)}`;
}

const BLANK: TemplateInput = {
  id: null,
  title: "",
  weekday: 3,
  start: "12:30",
  end: "14:00",
  location: "",
  openMode: "auto",
  openDaysBefore: 1,
  openTime: "09:00",
  lists: [
    { name: "Skills", cap: 40, makesTeams: false },
    { name: "Games", cap: 40, makesTeams: true },
  ],
};

function toInput(t: Template): TemplateInput {
  return {
    id: t.id,
    title: t.title,
    weekday: t.weekday,
    start: hhmm(t.start_time),
    end: hhmm(t.end_time),
    location: t.location,
    openMode: t.open_mode,
    openDaysBefore: t.open_days_before,
    openTime: hhmm(t.open_time),
    lists: t.template_lists.map((l) => ({ name: l.name, cap: l.cap, makesTeams: l.makes_teams })),
  };
}

export function ScheduleEditor({ templates, canEdit }: { templates: Template[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<TemplateInput | null>(null);
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const pause = useAction();

  return (
    <div className="space-y-3">
      {!canEdit && <p className="rounded-xl bg-columbia-50 p-3 text-sm">Only presidents can change the schedule.</p>}
      <Flash result={flash ?? pause.result} onClose={() => (setFlash(null), pause.clear())} />

      {templates.length === 0 && (
        <Card className="text-center">
          <p className="font-display text-3xl">No practices in the schedule</p>
          <p className="mx-auto mt-2 max-w-sm text-muted">
            Add each weekly practice once (for example Monday, Wednesday and Friday). The app creates every upcoming practice from it.
          </p>
        </Card>
      )}

      {templates.map((t) => (
        <Card key={t.id} className={cx(t.paused && "opacity-70")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-3xl leading-none">
                {WEEKDAYS[t.weekday]} · {timeOfDay(t.start_time)}–{timeOfDay(t.end_time)}
              </p>
              <p className="mt-1 text-sm text-muted">
                {t.title} · {t.location}
              </p>
            </div>
            {t.paused && <Chip kind="gold">Paused</Chip>}
          </div>
          <p className="mt-3 text-sm">
            {t.template_lists.map((l) => `${l.name} ${l.cap}${l.makes_teams ? " (teams)" : ""}`).join(" · ")}
          </p>
          <p className="mt-1 text-sm">{opensLine(t)}</p>
          {canEdit && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button kind="outline" className="h-10 text-lg" onClick={() => setEditing(toInput(t))}>
                Edit
              </Button>
              <Button kind="ghost" className="h-10 text-lg" disabled={pause.pending} onClick={() => pause.run(() => setTemplatePaused(t.id, !t.paused))}>
                {t.paused ? "Resume" : "Pause"}
              </Button>
              <ConfirmButton
                label="Delete"
                kind="ghost"
                confirmKind="danger"
                className="ml-auto h-10 text-lg text-kickoff"
                title={`Delete ${WEEKDAYS[t.weekday]}?`}
                body="Upcoming practices nobody has signed up for are removed. Practices with sign-ups stay, so nobody loses a spot. To skip a few weeks, use Pause instead."
                confirm="Delete"
                action={() => deleteTemplate(t.id)}
                onDone={setFlash}
              />
            </div>
          )}
        </Card>
      ))}

      {canEdit && (
        <Button kind={templates.length ? "outline" : "primary"} className="w-full" onClick={() => setEditing({ ...BLANK, lists: BLANK.lists.map((l) => ({ ...l })) })}>
          + Add a weekly practice
        </Button>
      )}

      <p className="pt-2 text-xs text-muted">
        Saving updates upcoming practices that nobody has signed up for yet. To change just one practice, open it from Practices and choose “Edit this practice”.
      </p>

      {editing && <TemplateSheet key={editing.id ?? "new"} initial={editing} onClose={() => setEditing(null)} onSaved={setFlash} />}
    </div>
  );
}

function TemplateSheet({ initial, onClose, onSaved }: { initial: TemplateInput; onClose: () => void; onSaved: (r: ActionResult) => void }) {
  const [v, setV] = useState(initial);
  const { pending, result, run } = useAction();
  const set = <K extends keyof TemplateInput>(k: K, val: TemplateInput[K]) => setV((x) => ({ ...x, [k]: val }));
  const setList = (i: number, patch: Partial<TemplateInput["lists"][number]>) =>
    setV((x) => ({ ...x, lists: x.lists.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const inline = cx(inputClass, "inline-block w-auto");

  return (
    <Sheet open onClose={onClose} title={initial.id ? "Edit weekly practice" : "New weekly practice"}>
      <form
        className="space-y-5 text-[15px]"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => saveTemplate({ ...v, title: v.title || `${WEEKDAYS[v.weekday]} practice` }),
            (r) => {
              onSaved(r);
              onClose();
            },
          );
        }}
      >
        <div className="flex flex-wrap items-center gap-2 leading-loose">
          Every
          <select value={v.weekday} onChange={(e) => set("weekday", Number(e.target.value))} className={inline} aria-label="Day">
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
          from
          <input type="time" required value={v.start} onChange={(e) => set("start", e.target.value)} className={inline} aria-label="Start time" />
          to
          <input type="time" required value={v.end} onChange={(e) => set("end", e.target.value)} className={inline} aria-label="End time" />
          at
          <input required value={v.location} onChange={(e) => set("location", e.target.value)} className={inputClass} placeholder="Riverside Park, field 4" aria-label="Place" />
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Name</span>
          <input value={v.title} onChange={(e) => set("title", e.target.value)} className={inputClass} placeholder={`${WEEKDAYS[v.weekday]} practice`} />
        </label>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold">Lists</legend>
          {v.lists.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-page p-2">
              <input required value={l.name} onChange={(e) => setList(i, { name: e.target.value })} className={cx(inputClass, "w-32 flex-1")} aria-label="List name" placeholder="Games" />
              <span>cap</span>
              <input
                type="number"
                min={1}
                max={500}
                required
                value={l.cap}
                onChange={(e) => setList(i, { cap: Number(e.target.value) })}
                className={cx(inputClass, "w-20")}
                aria-label="Cap"
              />
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={l.makesTeams} onChange={(e) => setList(i, { makesTeams: e.target.checked })} className="size-4 accent-core" />
                split into teams
              </label>
              {v.lists.length > 1 && (
                <button type="button" onClick={() => set("lists", v.lists.filter((_, j) => j !== i))} className="ml-auto px-2 text-muted hover:text-kickoff" aria-label="Remove list">
                  ✕
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => set("lists", [...v.lists, { name: "", cap: 40, makesTeams: false }])} className="text-sm font-bold text-core hover:underline">
            + Add list
          </button>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold">Sign-ups open</legend>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" checked={v.openMode === "auto"} onChange={() => set("openMode", "auto")} className="size-4 accent-core" />
            <select value={v.openDaysBefore} onChange={(e) => set("openDaysBefore", Number(e.target.value))} className={inline} aria-label="Days before" disabled={v.openMode !== "auto"}>
              <option value={0}>the same day</option>
              <option value={1}>the day before</option>
              <option value={2}>2 days before</option>
              <option value={3}>3 days before</option>
              <option value={7}>a week before</option>
            </select>
            at
            <input type="time" value={v.openTime} onChange={(e) => set("openTime", e.target.value)} className={inline} aria-label="Open time" disabled={v.openMode !== "auto"} />
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={v.openMode === "manual"} onChange={() => set("openMode", "manual")} className="size-4 accent-core" />
            when a board member presses “Open sign-ups”
          </label>
        </fieldset>

        <p className="rounded-xl bg-columbia-50 p-3 text-sm">
          Lists lock 2 hours before kickoff. After that nobody new can sign up and the waitlist stops moving up on its own, so the board can plan teams.
        </p>

        {result && !result.ok && <Flash result={result} />}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>
    </Sheet>
  );
}
