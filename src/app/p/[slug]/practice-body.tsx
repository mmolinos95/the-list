"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js";
import { myStatus, signUp } from "@/app/actions";
import { Countdown } from "@/components/live";
import { listSummary, listTime } from "@/components/practice";
import { Button, Card, Check, Field, inputClass, Label, TeamDot, WaitRing, cx } from "@/components/ui";
import type { MySpot, Practice, PublicList } from "@/lib/data";
import { getLink, getMe, setLink, setMe, type Me } from "@/lib/remember";
import { clock, relativeDay } from "@/lib/time";
import { TEAM_LABEL, TEAMS } from "@/lib/types";

type Status = { name: string | null; spots: MySpot[] };

export function PracticeBody({ practice, signupKey }: { practice: Practice; signupKey: string }) {
  const { event, stage, lists } = practice;
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Recognize this browser: if it signed up before, show its live status.
  useEffect(() => {
    const t = getLink(event.id);
    // Browser storage is only readable after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(t);
    if (t) myStatus(t).then((s) => s && setStatus(s));
  }, [event.id, practice]);

  const mine = new Set(status?.spots.map((s) => s.signupId));
  const canSignUp = stage === "open" || stage === "soon" || stage === "waiting";
  const remaining = lists.filter((l) => !status?.spots.some((s) => s.listId === l.id));

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-5">
      {stage === "cancelled" && (
        <Card className="border-2 border-kickoff">
          <p className="font-display text-4xl text-kickoff">Practice is off</p>
          <p className="mt-1">{event.cancel_reason ?? "This practice was cancelled."} Watch the WhatsApp group for the next one.</p>
        </Card>
      )}

      {stage === "soon" && event.opens_at && (
        <Card className="bg-ink! text-white">
          <Label className="text-columbia!">Sign-ups open {relativeDay(event.opens_at)}</Label>
          <div className="mt-3">
            <Countdown to={event.opens_at} />
          </div>
          <p className="mt-3 text-sm text-white/80">Fill in your details below now. The button switches on by itself the second the list opens.</p>
        </Card>
      )}

      {stage === "waiting" && (
        <Card>
          <p className="font-display text-3xl">Opening soon</p>
          <p className="mt-1 text-muted">The board will open sign-ups for this practice. Watch the WhatsApp group, or keep this page open.</p>
        </Card>
      )}

      {(stage === "locked" || stage === "teams") && (
        <div className="rounded-xl bg-kickoff px-4 py-3 text-sm font-semibold text-white">
          Sign-ups closed at {clock(event.locks_at)}. Kickoff is at {clock(event.starts_at)}.
        </div>
      )}

      {status && status.spots.length > 0 && token && <StatusCard status={status} token={token} practice={practice} />}

      {canSignUp && remaining.length > 0 && (
        <SignupCard
          practice={practice}
          signupKey={signupKey}
          lists={remaining}
          alsoMode={!!status?.spots.length}
          onDone={(t, s) => {
            if (t) {
              setLink(event.id, t);
              setToken(t);
            }
            setStatus(s);
          }}
        />
      )}

      {stage !== "cancelled" && <ListTabs practice={practice} mine={mine} teamsOut={stage === "teams" || stage === "past"} />}
    </div>
  );
}

// Your status ---------------------------------------------------------------------

function StatusCard({ status, token, practice }: { status: Status; token: string; practice: Practice }) {
  const { event, stage } = practice;
  const inAny = status.spots.some((s) => s.spot === "main");
  const first = status.name?.split(" ")[0] ?? "";
  const canDrop = stage !== "past" && stage !== "cancelled";

  return (
    <Card className="border-2 border-gold">
      <p className="font-display text-4xl leading-none">{inAny ? `You're in, ${first}` : `You're on the waitlist, ${first}`}</p>
      <ul className="mt-4 space-y-2">
        {status.spots.map((s) => (
          <li key={s.signupId} className="flex items-center gap-3 rounded-xl bg-columbia-50 px-3 py-2.5">
            {s.spot === "main" ? <Check /> : <WaitRing />}
            <div className="flex-1">
              <p className="font-display text-xl leading-tight">
                {s.spot === "main" ? `In · ${s.list} #${s.position} of ${s.cap}` : `#${s.position} on the ${s.list} waitlist`}
              </p>
              {s.team && (
                <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
                  <TeamDot team={s.team} className="size-4" /> You&apos;re on {TEAM_LABEL[s.team]}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {status.spots.some((s) => s.spot === "waitlist") && (stage === "open" || stage === "soon") && (
        <p className="mt-3 text-sm text-muted">If someone drops before {clock(event.locks_at)}, you move up automatically and we&apos;ll email you.</p>
      )}
      {status.spots.some((s) => s.spot === "main" && s.teamsOut === false) && stage !== "past" && (
        <p className="mt-3 text-sm text-muted">We emailed you a confirmation. Your team color comes once the board picks teams.</p>
      )}
      {canDrop && (
        <p className="mt-4 text-sm">
          Can&apos;t make it?{" "}
          <Link href={`/drop/${token}`} className="font-semibold text-core underline underline-offset-2">
            Drop out
          </Link>{" "}
          so a teammate gets your spot.
        </p>
      )}
    </Card>
  );
}

// Sign-up form -------------------------------------------------------------------

const countryName = (() => {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return (c: string) => names.of(c) ?? c;
  } catch {
    return (c: string) => c;
  }
})();

const noSubscribe = () => () => {};

function SignupCard({
  practice,
  signupKey,
  lists,
  alsoMode,
  onDone,
}: {
  practice: Practice;
  signupKey: string;
  lists: PublicList[];
  alsoMode: boolean;
  onDone: (token: string | null, status: Status) => void;
}) {
  const { event, stage } = practice;
  const [me, setMeState] = useState<Me | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("US");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const listKey = lists.map((l) => l.id).join();
  useEffect(() => {
    const saved = getMe();
    if (saved) {
      // Browser storage is only readable after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMeState(saved);
      setName(saved.name);
      setEmail(saved.email);
      setPhone(saved.phone);
      setCountry(saved.country || "US");
    }
    // Default to the lists picked last time, or the only list.
    const byName = new Set(saved?.lists ?? []);
    const initial = lists.length === 1 ? lists : lists.filter((l) => byName.has(l.name));
    setPicked(new Set(initial.map((l) => l.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  // Country names come from the runtime's ICU data, which differs between Node and browsers,
  // so the server renders only the selected country and the browser fills in the rest.
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  const allCountries = useMemo(
    () =>
      getCountries()
        .map((c) => ({ code: c, label: `${countryName(c)} (+${getCountryCallingCode(c)})` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [],
  );
  const countries = inBrowser ? allCountries : allCountries.filter((c) => c.code === country);

  const chosen = lists.filter((l) => picked.has(l.id));
  const allFull = chosen.length > 0 && chosen.every((l) => l.main.length >= l.cap);
  const open = stage === "open";
  const showFields = !me || editing;

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await signUp({ eventId: event.id, signupKey, listIds: [...picked], name, email, phone, country });
      if (!res.ok) {
        setError({ message: res.error, field: res.field });
        return;
      }
      const saved: Me = { name: res.name, email: email.trim().toLowerCase(), phone, country, lists: chosen.map((l) => l.name) };
      setMe(saved);
      setMeState(saved);
      setEditing(false);
      if (!res.created) {
        setNotice("You're already on that list. Check your email for your personal link to manage your spot.");
      } else {
        const lostRace = res.spots.some((s) => s.spot === "waitlist" && chosen.find((l) => l.id === s.listId && l.main.length < l.cap));
        if (lostRace) setNotice("The last spot just went, so you're on the waitlist. You'll move up automatically if someone drops.");
      }
      onDone(res.token, { name: res.name, spots: res.spots });
    });
  }

  const buttonLabel = !open
    ? stage === "soon" && event.opens_at
      ? `Opens ${relativeDay(event.opens_at)}`
      : "Not open yet"
    : allFull
      ? "Join the waitlist"
      : "Save my spot";

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        {alsoMode && <p className="font-display text-2xl">Also join</p>}

        {!showFields ? (
          <div>
            <p className="text-lg font-semibold">Welcome back, {me!.name.split(" ")[0]} 👋</p>
            <p className="mt-1 text-sm text-muted">
              {me!.email} · {me!.phone}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
              <Field label="Full name" error={error?.field === "name" ? error.message : undefined}>
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Sofia Ramirez" required />
              </Field>
              <Field label="Email" hint="Your confirmation and drop-out link go here." error={error?.field === "email" ? error.message : undefined}>
                <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" required />
              </Field>
              <Field label="Phone" hint="Kept private. Only the board can see it." error={error?.field === "phone" ? error.message : undefined}>
                <div className="flex gap-2">
                  {/* inputClass sets w-full, so the select's width comes from this wrapper. */}
                  <div className="w-28 shrink-0">
                    <select className={inputClass} value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country code">
                      {countries.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code === country ? `${c.code} +${getCountryCallingCode(c.code as CountryCode)}` : c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input className={cx(inputClass, "min-w-0")} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel-national" placeholder="212 555 0148" required />
                </div>
              </Field>
          </div>
        )}

        <fieldset>
          <legend className="sr-only">Lists</legend>
          <div className={cx("grid gap-2", lists.length > 1 && "grid-cols-2")}>
            {lists.map((l) => {
              const on = picked.has(l.id);
              const full = l.main.length >= l.cap;
              return (
                <label
                  key={l.id}
                  className={cx(
                    "flex cursor-pointer items-start gap-3 rounded-xl border-2 px-3 py-3 transition-colors",
                    on ? "border-core bg-core text-white" : "border-line bg-white",
                  )}
                >
                  <input type="checkbox" className="mt-1 size-4 accent-gold" checked={on} onChange={() => toggle(l.id)} />
                  <span>
                    <span className="block font-display text-2xl leading-none">{l.name}</span>
                    {listTime(l, event) && <span className="mt-0.5 block text-sm">{listTime(l, event)}</span>}
                    <span className={cx("mt-1 block text-[11px] font-bold uppercase tracking-wider", on ? "text-columbia" : "text-muted")}>
                      {full ? `Full · you'd be #${l.waitlist.length + 1} waiting` : listSummary(l)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {error && !error.field && <p className="text-sm font-semibold text-kickoff">{error.message}</p>}
        {error?.field && !showFields && <p className="text-sm font-semibold text-kickoff">{error.message} Tap &quot;Edit details&quot; to fix it.</p>}

        <Button type="submit" className="w-full h-13 text-2xl" disabled={!open || pending || picked.size === 0}>
          {pending ? "Saving…" : buttonLabel}
        </Button>

        {!showFields && (
          <button type="button" onClick={() => setEditing(true)} className="text-sm font-semibold text-core underline-offset-2 hover:underline">
            Not you? Edit details
          </button>
        )}
        {notice && <p className="rounded-lg bg-columbia-50 px-3 py-2 text-sm">{notice}</p>}
        {open && allFull && (
          <p className="text-sm text-muted">
            If someone drops before {clock(event.locks_at)}, the waitlist moves up automatically in order.
          </p>
        )}
      </form>
    </Card>
  );
}

// The public list -------------------------------------------------------------------

function ListTabs({ practice, mine, teamsOut }: { practice: Practice; mine: Set<string>; teamsOut: boolean }) {
  const { event, lists } = practice;
  const [tab, setTab] = useState(0);
  const list = lists[Math.min(tab, lists.length - 1)];
  if (!list) return null;
  const showTeams = teamsOut && list.makes_teams && !!list.teams_sent_at;

  return (
    <section className="pt-2">
      {lists.length > 1 && (
        <div className="mb-3 flex gap-2" role="tablist">
          {lists.map((l, i) => (
            <button
              key={l.id}
              role="tab"
              aria-selected={i === tab}
              onClick={() => setTab(i)}
              className={cx(
                "flex-1 rounded-xl px-3 py-2 text-left transition-colors",
                i === tab ? "bg-core text-white" : "bg-white text-ink",
              )}
            >
              <span className="block font-display text-2xl leading-none">{l.name}</span>
              <span className={cx("text-[11px] font-bold uppercase tracking-wider", i === tab ? "text-columbia" : "text-muted")}>
                {[listTime(l, event), listSummary(l)].filter(Boolean).join(" · ")}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-display text-3xl">{showTeams ? "The teams" : "The list"}</h2>
        <Label>{list.main.length} in</Label>
      </div>

      {showTeams ? (
        <div className="grid grid-cols-2 gap-2">
          {TEAMS.map((team) => {
            const players = list.main.filter((s) => s.team === team);
            return (
              <div key={team} className="rounded-xl bg-white p-3">
                <p className="mb-2 flex items-center gap-2 font-display text-xl">
                  <TeamDot team={team} className="size-4" /> {TEAM_LABEL[team]} <span className="text-sm text-muted">{players.length}</span>
                </p>
                <ul className="space-y-1 text-sm">
                  {players.map((s) => (
                    <li key={s.id} className={cx(mine.has(s.id) && "font-bold")}>
                      {s.name}
                      {mine.has(s.id) && " (you)"}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : list.main.length === 0 ? (
        <p className="rounded-xl border-2 border-dashed border-line p-5 text-center text-muted">Nobody yet. Be the first.</p>
      ) : (
        <ol className="space-y-1.5">
          {list.main.map((s, i) => (
            <Row key={s.id} n={i + 1} name={s.name} me={mine.has(s.id)} icon={<Check />} />
          ))}
        </ol>
      )}

      {!showTeams && list.waitlist.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 font-display text-2xl">Waitlist</h3>
          <ol className="space-y-1.5">
            {list.waitlist.map((s, i) => (
              <Row key={s.id} n={i + 1} name={s.name} me={mine.has(s.id)} icon={<WaitRing />} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function Row({ n, name, me, icon }: { n: number; name: string; me: boolean; icon: React.ReactNode }) {
  return (
    <li className={cx("flex items-center gap-3 rounded-xl px-3 py-2.5", me ? "bg-columbia ring-2 ring-core" : "bg-white")}>
      <span className="w-7 font-display text-xl text-core tabular-nums">{String(n).padStart(2, "0")}</span>
      <span className="flex-1 truncate">
        {name}
        {me && <span className="ml-2 text-[11px] font-bold uppercase tracking-wider">You</span>}
      </span>
      {icon}
    </li>
  );
}

