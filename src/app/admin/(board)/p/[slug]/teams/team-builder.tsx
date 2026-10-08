"use client";

import { DndContext, MouseSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useState, useTransition } from "react";
import { ConfirmButton, Flash, Sheet, useAction } from "@/components/admin-ui";
import { Button, TeamDot, cx } from "@/components/ui";
import type { AdminList, AdminSignup } from "@/lib/admin-data";
import { TEAM_LABEL, TEAMS, type TeamColor } from "@/lib/types";
import { type ActionResult, sendTeams, setTeam, shuffleTeams } from "../../../../actions";

// Tap a name, then a color (phones). Or drag a name onto a team (desktop).
// Every move is saved right away; nothing is emailed until SEND.

const UNASSIGNED = "none";
type Slot = TeamColor | typeof UNASSIGNED;

const players = (n: number) => `${n} ${n === 1 ? "player" : "players"}`;

const TEAM_BG: Record<TeamColor, string> = {
  black: "bg-ink text-white",
  white: "bg-white text-ink border-b border-line",
  red: "bg-kickoff text-white",
  light_blue: "bg-columbia text-ink",
};

export function TeamBuilder({ eventId, lists }: { eventId: string; lists: AdminList[] }) {
  const [overrides, setOverrides] = useState<Record<string, TeamColor | null>>({});
  const [picking, setPicking] = useState<AdminSignup | null>(null);
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const [, start] = useTransition();
  const shuffle = useAction();
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }));

  const teamOf = (s: AdminSignup) => (s.id in overrides ? overrides[s.id] : s.team);
  const all = lists.flatMap((l) => l.main);
  const sent = lists.some((l) => l.teams_sent_at);
  const assigned = all.filter((s) => teamOf(s)).length;
  const changed = all.filter((s) => teamOf(s) && teamOf(s) !== s.team_sent).length;

  function move(s: AdminSignup, team: TeamColor | null) {
    if (teamOf(s) === team) return;
    setOverrides((o) => ({ ...o, [s.id]: team }));
    start(async () => {
      const r = await setTeam(s.id, team);
      if (!r.ok) {
        setFlash(r);
        setOverrides((o) => {
          const next = { ...o };
          delete next[s.id];
          return next;
        });
      }
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const s = all.find((x) => x.id === e.active.id);
    const [, slot] = String(e.over?.id ?? "").split(":");
    if (s && slot) move(s, slot === UNASSIGNED ? null : (slot as TeamColor));
  }

  const doShuffle = () => shuffleTeams(eventId);
  const afterShuffle = (r: ActionResult) => {
    setOverrides({});
    setFlash(r);
  };

  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        {assigned > 0 ? (
          <ConfirmButton
            label="Shuffle into teams"
            kind="outline"
            className="sm:flex-1"
            title="Reshuffle everyone?"
            body="Everyone on the main list gets a new random team. Moves you made by hand are lost."
            confirm="Reshuffle"
            action={doShuffle}
            onDone={afterShuffle}
          />
        ) : (
          <Button kind="outline" className="sm:flex-1" disabled={shuffle.pending || all.length === 0} onClick={() => shuffle.run(doShuffle, afterShuffle)}>
            {shuffle.pending ? "Shuffling…" : "Shuffle into teams"}
          </Button>
        )}
        {!sent ? (
          <ConfirmButton
            label="Send teams"
            className="sm:flex-1"
            disabled={changed === 0}
            title="Send teams?"
            body={
              <>
                Email {players(changed)} their team color and show the teams on the practice page.
                {assigned < all.length && ` ${all.length - assigned} still have no team and won't get an email.`}
              </>
            }
            confirm={`Email ${players(changed)}`}
            action={() => sendTeams(eventId)}
            onDone={setFlash}
          />
        ) : (
          <ConfirmButton
            label={`Send updates (${changed})`}
            className="sm:flex-1"
            disabled={changed === 0}
            title="Send updates?"
            body={`Email only the ${players(changed)} whose team changed or who are new. Everyone else already knows their team.`}
            confirm={`Email ${players(changed)}`}
            action={() => sendTeams(eventId)}
            onDone={setFlash}
          />
        )}
      </div>
      {shuffle.result && !shuffle.result.ok && <Flash result={shuffle.result} />}
      <Flash result={flash} onClose={() => setFlash(null)} />
      <p className="text-sm text-muted">
        <span className="sm:hidden">Tap a name to pick their team.</span>
        <span className="hidden sm:inline">Drag names between teams, or click a name to pick.</span>
        {sent ? " Teams are out. Moves are saved, and SEND UPDATES emails only the people who moved." : " Moves are saved as you go. Nobody is emailed until you press SEND TEAMS."}
      </p>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {lists.map((l) => (
          <section key={l.id} className="space-y-3">
            {lists.length > 1 && <h2 className="font-display text-3xl">{l.name}</h2>}
            <Zone listId={l.id} slot={UNASSIGNED} title="Unassigned" people={l.main.filter((s) => !teamOf(s))} teamOf={teamOf} sent={!!l.teams_sent_at} onPick={setPicking} />
            <div className="grid gap-3 sm:grid-cols-2">
              {TEAMS.map((t) => (
                <Zone key={t} listId={l.id} slot={t} title={TEAM_LABEL[t]} people={l.main.filter((s) => teamOf(s) === t)} teamOf={teamOf} sent={!!l.teams_sent_at} onPick={setPicking} />
              ))}
            </div>
          </section>
        ))}
      </DndContext>

      <Sheet open={!!picking} onClose={() => setPicking(null)} title={picking ? picking.member.name : ""}>
        {picking && (
          <div className="grid grid-cols-2 gap-2">
            {TEAMS.map((t) => (
              <button
                key={t}
                onClick={() => {
                  move(picking, t);
                  setPicking(null);
                }}
                className={cx(
                  "flex h-16 items-center justify-center gap-2 rounded-xl border-2 font-display text-2xl",
                  teamOf(picking) === t ? "border-core ring-2 ring-core/30" : "border-line",
                )}
              >
                <TeamDot team={t} className="size-6" /> {TEAM_LABEL[t]}
              </button>
            ))}
            <button
              onClick={() => {
                move(picking, null);
                setPicking(null);
              }}
              className="col-span-2 h-12 rounded-xl border-2 border-line text-sm font-semibold text-muted"
            >
              No team yet
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function Zone({
  listId,
  slot,
  title,
  people,
  teamOf,
  sent,
  onPick,
}: {
  listId: string;
  slot: Slot;
  title: string;
  people: AdminSignup[];
  teamOf: (s: AdminSignup) => TeamColor | null;
  sent: boolean;
  onPick: (s: AdminSignup) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${listId}:${slot}` });
  const team = slot === UNASSIGNED ? null : slot;
  if (!team && people.length === 0) return <div ref={setNodeRef} className={cx("rounded-xl border-2 border-dashed border-line p-3 text-center text-sm text-muted", isOver && "border-core")}>Everyone has a team. Drop a name here to take them off a team.</div>;
  return (
    <div ref={setNodeRef} className={cx("overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgb(17_20_24/0.06)]", isOver && "ring-2 ring-core", !team && "border-2 border-dashed border-gold")}>
      <div className={cx("flex items-center justify-between px-4 py-2", team ? TEAM_BG[team] : "bg-gold/20")}>
        <span className="font-display text-2xl">{title.toUpperCase()}</span>
        <span className="font-display text-2xl tabular-nums">{people.length}</span>
      </div>
      <ul className="flex flex-wrap gap-1.5 p-3">
        {people.length === 0 && <li className="text-sm text-muted">Nobody yet</li>}
        {people.map((s) => (
          <Person key={s.id} s={s} isNew={sent && !s.team_sent} moved={sent && !!s.team_sent && teamOf(s) !== s.team_sent} onPick={onPick} />
        ))}
      </ul>
    </div>
  );
}

function Person({ s, isNew, moved, onPick }: { s: AdminSignup; isNew: boolean; moved: boolean; onPick: (s: AdminSignup) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: s.id });
  return (
    <li>
      <button
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        onClick={() => onPick(s)}
        style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
        className={cx(
          "relative rounded-full border border-line bg-page px-3 py-1.5 text-sm font-medium hover:border-core",
          isDragging && "z-30 shadow-lg",
        )}
      >
        {s.member.name}
        {isNew && <span className="ml-1.5 rounded bg-gold px-1 text-[10px] font-bold uppercase">New</span>}
        {moved && <span className="ml-1.5 rounded bg-core px-1 text-[10px] font-bold uppercase text-white">Moved</span>}
      </button>
    </li>
  );
}
