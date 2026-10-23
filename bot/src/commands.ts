import { timeRange } from "../../src/lib/time";
import { ask, type AiModel } from "./ai";
import type { Feature } from "./config";
import type { Data, Practice } from "./data/types";
import * as f from "./format";
import type { ChangeItem } from "./format";
import type { Asker } from "./identity";
import type { Command } from "./parse";
import { linkUrl } from "./phone";
import { matchLists, pickPractice } from "./pick";
import type { ChatMemory } from "./memory";
import type { Weather } from "./weather";
import { addQuietly, cancelQuietly, dropQuietly, signUpQuietly, type Promotion } from "./quiet";
import { signupUrl } from "./links";
import { chatPost, selectorFor, sharePost } from "./share";

// Runs a parsed command for someone. Every permission check lives here, so a
// command picked by Gemini (ai.ts) gets exactly the same checks as a typed one.

/**
 * One message to send. `mentions` are WhatsApp IDs written as "@<number>" in the text.
 * `listOf` marks a message carrying a practice's full list (an event id): the bot
 * deletes its previous one for that practice, so only the newest stays in the chat.
 * `change` marks a list change (sign-up, drop-out, walk-in): in WhatsApp the bot
 * batches those into one list message (batch.ts) instead of sending `text`; the
 * terminal (cli.ts) just prints `text`.
 */
export type Out = { text: string; quote: boolean; mentions?: string[]; listOf?: string; change?: ListChange };

/** What one write changed on a practice's list. */
export type ListChange = { eventId: string; items: ChangeItem[] };

export type CommandDeps = {
  data: Data;
  features: Set<Feature>;
  botPhone: string | null;
  siteUrl: string;
  dropLinkSecret: string | null;
  now: () => Date;
  /** Gemini (gemini.ts), for free-text questions. */
  ai?: AiModel;
  /** The WhatsApp ID to @mention for a member's email, if they linked one (state.ts). */
  mentionFor?: (email: string) => string | null;
  /** Recent exchanges per chat, for Gemini's follow-ups (memory.ts). */
  memory?: ChatMemory;
  /** The club FAQ for Gemini (faq.ts); "" for none. */
  faq?: string;
  /** Practice forecasts for Gemini (weather.ts). */
  weather?: Pick<Weather, "at">;
};

export type Request = {
  asker: Asker | null;
  /** Where the confirmation of a two-step command must come from: "<chat>|<sender>". */
  chatKey: string;
  /** A swipe-reply to the bot (not an @mention): Gemini may decide no answer is needed. */
  replyToBot?: boolean;
};

const chatOf = (req: Request) => req.chatKey.split("|")[0];
const senderOf = (req: Request) => req.chatKey.slice(req.chatKey.indexOf("|") + 1);

/** A command as someone would type it, for Gemini's memory: "!in mon games". */
export function typed(cmd: Command): string {
  const bits: string[] = [cmd.kind];
  if ("practice" in cmd && cmd.practice) bits.push(cmd.practice);
  if ("lists" in cmd && cmd.lists) bits.push(cmd.lists);
  if ("rest" in cmd && cmd.rest) bits.push(cmd.rest);
  if ("reason" in cmd && cmd.reason) bits.push(cmd.reason);
  if ("confirm" in cmd && cmd.confirm) bits.push("yes");
  return `!${bits.join(" ")}`;
}

const reply = (text: string): Out[] => [{ text, quote: true }];

/** Database error codes (raise exception '...') in plain words. */
const FRIENDLY: [string, string][] = [
  ["not_open", "Sign-ups aren't open yet."],
  ["locked", "Sorry, the list has locked. Sign-ups close 2 hours before kickoff."],
  ["event_cancelled", "This practice was cancelled."],
  ["event_over", "This practice is already over."],
  ["event_not_found", "I couldn't find that practice."],
  ["already_cancelled", "This practice was already cancelled."],
  ["already_on_list", "They're already on that list."],
  ["members_phone_check", "Your saved phone number doesn't look right. Send me `link` in a DM to fix it."],
];

export function friendly(err: unknown): string | null {
  const text = err instanceof Error ? err.message : String(err);
  return FRIENDLY.find(([code]) => text.includes(code))?.[1] ?? null;
}

/** Two-step commands (cancel, late drop) wait here for "yes" from the same person in the same chat. */
class Pending {
  private items = new Map<string, { value: string; until: number }>();
  set(key: string, value: string, now: number) {
    this.items.set(key, { value, until: now + 10 * 60_000 });
  }
  take(key: string, now: number) {
    const item = this.items.get(key);
    this.items.delete(key);
    return item && item.until > now ? item.value : null;
  }
}

/** A practice whose sign-ups haven't opened yet. */
const isNotOpenYet = (p: Practice) => p.stage === "soon" || p.stage === "waiting";

/** The feature each command needs. */
export const FEATURE_OF: Record<Command["kind"], Feature> = {
  week: "read",
  help: "read",
  list: "read",
  me: "read",
  where: "read",
  post: "post",
  in: "signup",
  out: "signup",
  open: "board",
  cancel: "board",
  add: "board",
  teams: "board",
  free: "ai",
};

export class Commands {
  private pending = new Pending();

  constructor(private deps: CommandDeps) {}

  private get now() {
    return this.deps.now();
  }

  async run(cmd: Command, req: Request): Promise<Out[]> {
    const out = await this.exec(cmd, req);
    // Free text remembers itself (with Gemini's answer); a typed command is noted as done.
    if (cmd.kind !== "free") this.deps.memory?.remember(chatOf(req), senderOf(req), typed(cmd), "(ran it and showed the result)");
    return out;
  }

  private async exec(cmd: Command, req: Request): Promise<Out[]> {
    if (!this.deps.features.has(FEATURE_OF[cmd.kind])) {
      if (cmd.kind === "free") return reply(`Sorry, I didn't get that.\n\n${this.help(req.asker, true)}`);
      return reply("That isn't switched on yet. For now, use the app or ask the board.");
    }
    switch (cmd.kind) {
      case "week":
        return this.overview(req);
      case "help":
        return reply(this.help(req.asker, false));
      case "list":
        return this.list(cmd.practice);
      case "me":
        return this.me(req);
      case "where":
        return this.where(cmd.practice);
      case "post":
        return this.post(cmd.practice, req);
      case "in":
        return this.write(() => this.signUp(cmd.practice, cmd.lists, req));
      case "out":
        return this.write(() => this.dropOut(cmd.practice, cmd.lists, cmd.confirm, req));
      case "open":
        return this.write(() => this.open(cmd.practice, req));
      case "cancel":
        return this.write(() => this.cancel(cmd.practice, cmd.reason, cmd.confirm, req));
      case "add":
        return this.write(() => this.add(cmd.practice, cmd.rest, req));
      case "teams":
        return this.write(() => this.teams(cmd.practice, req));
      case "free":
        return this.free(cmd.text, req);
      default:
        return reply(`Sorry, I didn't get that.\n\n${this.help(req.asker, true)}`);
    }
  }

  // Phase 1: reading --------------------------------------------------------------

  private async overview(req: Request): Promise<Out[]> {
    const now = this.now;
    const soon = (await this.deps.data.upcoming(now, 8)).slice(0, 5);
    const lines = soon.length ? ["*Upcoming practices*", ...soon.map((p) => f.overviewItem(p, now))] : ["No practices in the next week."];
    return reply(`${lines.join("\n\n")}\n\n${this.help(req.asker, true)}`);
  }

  help(asker: Asker | null, short: boolean) {
    const has = (x: Feature) => this.deps.features.has(x);
    if (short) {
      const bits = ["`!list thu` who's in", "`!me` your spots"];
      if (has("signup")) bits.push("`!in` / `!out`");
      if (has("ai")) bits.push("or @mention me with a question");
      return `${bits.join(" · ")} · \`!help\``;
    }
    const lines = [
      "*The List bot*",
      "`!list` who's in for the next practice",
      "`!list thu` one practice (also `next`, `tomorrow`, `10/23`)",
      "`!week` upcoming practices",
      "`!me` your spots",
      "`!where` where the next practice is, with a map (or `!where thu`)",
    ];
    if (has("signup")) lines.push("`!in` sign up for the open practice (or `!in thu [list]`)", "`!out` drop out (or `!out thu [list]`)");
    if (has("ai")) lines.push("Or @mention me with a question.");
    if (asker?.board && (has("post") || has("board"))) {
      lines.push("", "*Board*");
      if (has("post")) lines.push("`!post` post the open practice (or `!post thu`)");
      if (has("board"))
        lines.push(
          "`!open` open the next practice's sign-ups now (or `!open thu`)",
          "`!cancel thu [reason]` cancel (asks to confirm)",
          "`!add thu Name [list] [waitlist]` add a walk-in",
          "`!teams thu` shuffle teams",
        );
    }
    return lines.join("\n");
  }

  /** The practice with everyone's names. No practice named means the next one. */
  private async list(selector: string): Promise<Out[]> {
    const p = await this.find(selector || "next");
    if (typeof p === "string") return reply(p);
    return [this.listOut(p, "")];
  }

  /** A message with `top` (if any) and the practice's full list, replacing the previous list in the chat. */
  private listOut(p: Practice, top: string, mentions: string[] = []): Out {
    let text = f.fullList(p, this.now);
    if (p.stage === "open" && this.deps.features.has("signup")) {
      const sel = selectorFor(p.event.starts_at, this.now);
      text += `\n\nSign up: \`!in ${sel}\` · Drop out: \`!out ${sel}\``;
    }
    return { text: top ? `${top}\n\n${text}` : text, quote: true, listOf: p.event.id, ...(mentions.length ? { mentions } : {}) };
  }

  /** The batched list message: what changed (in order), then the practice's full list as it is now. */
  async changeMessage(eventId: string, items: ChangeItem[]): Promise<Out | null> {
    const p = await this.deps.data.practice(eventId, this.now);
    if (!p) return null;
    const { text, mentions } = f.changeSummary(items, p.lists.length > 1);
    return this.listOut(p, text, mentions);
  }

  /** The practice as it is now, after a write. */
  private async fresh(p: Practice) {
    return (await this.deps.data.practice(p.event.id, this.now)) ?? p;
  }

  /** Where a practice is, with a Google Maps link. No practice named means the next one. */
  private async where(selector: string): Promise<Out[]> {
    const p = await this.find(selector || "next");
    if (typeof p === "string") return reply(p);
    const lines = [`*${p.event.title} · ${f.day(p)}*`, `${timeRange(p.event.starts_at, p.event.ends_at)} · ${p.event.location}`, f.mapsUrl(p.event.location)];
    if (p.stage === "cancelled") lines.push("_This practice is cancelled._");
    return reply(lines.join("\n"));
  }

  private async me(req: Request): Promise<Out[]> {
    const who = this.needMember(req.asker);
    if (typeof who === "string") return reply(who);
    if (!who.member) return reply("You're not on any list yet. Sign up with `!in thu`.");
    const practices = await this.deps.data.upcoming(this.now, 14);
    const lines = f.mySpots(practices, who.member.id);
    return reply(lines.length ? `*Your spots*\n${lines.join("\n")}` : "You're not on any upcoming list.");
  }

  // Phase 2: the board's sign-up post ----------------------------------------------

  private async post(selector: string, req: Request): Promise<Out[]> {
    const who = this.needBoard(req.asker);
    if (typeof who === "string") return reply(who);
    // With sign-ups in WhatsApp on, the post is about the commands and the link is
    // just a fallback; without them, it's the app's post, which needs the link.
    const inChat = this.deps.features.has("signup");
    if (!inChat && !this.deps.dropLinkSecret) return reply("I can't make sign-up links: DROP_LINK_SECRET isn't set on the bot.");
    const p = await this.findOr(selector, (x) => x.stage === "open" || isNotOpenYet(x), "There's no upcoming practice to post.");
    if (typeof p === "string") return reply(p);
    const sel = selector || selectorFor(p.event.starts_at, this.now);
    if (p.stage === "cancelled") return reply(`${f.day(p)} is cancelled, so there's nothing to post.`);
    if (p.stage === "past") return reply(`${f.day(p)} is over.`);
    const secret = this.deps.dropLinkSecret;
    const text = inChat
      ? chatPost(p.event, p.lists, this.now, secret ? signupUrl(secret, this.deps.siteUrl, p.event) : null)
      : sharePost(secret!, this.deps.siteUrl, p.event, p.lists);
    const out: Out[] = [{ text, quote: false }];
    if (p.stage === "waiting") {
      const how = this.deps.features.has("board") ? ` Open them with \`!open ${sel}\`.` : " Open them in the app.";
      const what = inChat ? "`!in` won't work until they open" : 'the link shows "opens soon"';
      out.push({ text: `Heads-up: sign-ups for ${f.day(p)} aren't open yet, so ${what}.${how}`, quote: true });
    }
    return out;
  }

  // Phase 3: signing up and dropping out -------------------------------------------

  private async signUp(selector: string, listText: string, req: Request): Promise<Out[]> {
    const who = this.needMember(req.asker);
    if (typeof who === "string") return reply(who);
    if (!who.name) return reply("I need your name first. Send me `link` in a DM to set it up.");
    const p = await this.findOr(selector, (x) => x.stage === "open" || isNotOpenYet(x), "There's no upcoming practice to sign up for.");
    if (typeof p === "string") return reply(p);
    const sel = selector || selectorFor(p.event.starts_at, this.now);
    const closed = this.closedFor(p, "sign up");
    if (closed) return reply(closed);

    let lists = p.lists;
    if (p.lists.length > 1 || listText) {
      const m = matchLists(listText, p.lists);
      if (m.unknown) return reply(`${f.day(p)} has no list called "${m.unknown}". Pick ${f.listChoices(p)}.`);
      if (m.lists.length === 0) {
        const names = p.lists.map((l) => `\`!in ${sel} ${l.name.toLowerCase()}\``);
        return reply(`Which list? ${f.listChoices(p)}.\nSend ${names.join(", ")} or \`!in ${sel} both\`.`);
      }
      lists = m.lists;
    }

    const r = await signUpQuietly(this.deps.data, p.event.id, lists.map((l) => l.id), who.name, who.email, who.phone);
    const order = (id: string) => p.lists.findIndex((l) => l.id === id);
    const lines = [...r.results].sort((a, b) => order(a.list_id) - order(b.list_id)).map((x) => {
      if (x.already) return x.spot === "main" ? `You're already on *${x.list}* (#${x.position} of ${x.cap}).` : `You're already #${x.position} on the *${x.list}* waitlist.`;
      if (x.spot === "main") return `You're in: *${x.list}*, #${x.position} of ${x.cap}.`;
      return `*${x.list}* is full. You're #${x.position} on the waitlist and move up on your own if a spot opens before the lock.`;
    });
    if (r.results.every((x) => x.already)) return reply(lines.join("\n"));
    const items: ChangeItem[] = r.results
      .filter((x) => !x.already)
      .sort((a, b) => order(a.list_id) - order(b.list_id))
      .map((x) => ({ kind: x.spot === "main" ? "in" : "wait", name: who.name!, list: x.list, position: x.position }));
    return [{ ...this.listOut(await this.fresh(p), lines.join("\n")), change: { eventId: p.event.id, items } }];
  }

  private async dropOut(selector: string, listText: string, confirm: boolean, req: Request): Promise<Out[]> {
    const who = this.needMember(req.asker);
    if (typeof who === "string") return reply(who);
    const onIt = (x: Practice) => x.stage !== "past" && x.stage !== "cancelled" && x.lists.some((l) => [...l.main, ...l.waitlist].some((s) => s.member_id === who.member?.id));
    const p = await this.findOr(selector, onIt, "You're not on any upcoming list.");
    if (typeof p === "string") return reply(p);
    const sel = selector || selectorFor(p.event.starts_at, this.now);
    if (p.stage === "cancelled") return reply(`${f.day(p)} is cancelled, so there's nothing to drop.`);
    if (p.stage === "past") return reply(`${f.day(p)} is over.`);

    const mine = who.member ? p.lists.filter((l) => [...l.main, ...l.waitlist].some((s) => s.member_id === who.member!.id)) : [];
    if (mine.length === 0) return reply(`You're not on ${f.day(p)}.`);
    let lists = mine;
    if (listText) {
      const m = matchLists(listText, p.lists);
      if (m.unknown || m.lists.length === 0) return reply(`${f.day(p)} has no list called "${m.unknown ?? listText}". You're on ${mine.map((l) => `*${l.name}*`).join(" and ")}.`);
      lists = m.lists.filter((l) => mine.includes(l));
      if (lists.length === 0) return reply(`You're not on ${m.lists.map((l) => `*${l.name}*`).join(" or ")} for ${f.day(p)}.`);
    }

    // After the lock a drop is a late drop, so ask first.
    const late = this.now.getTime() >= Date.parse(p.event.locks_at) && lists.some((l) => l.main.some((s) => s.member_id === who.member!.id));
    const key = `${req.chatKey}|out|${p.event.id}`;
    if (late && !(confirm || this.pending.take(key, this.now.getTime()))) {
      this.pending.set(key, "yes", this.now.getTime());
      const cmd = `!out ${sel}${listText ? ` ${listText}` : ""} yes`;
      return reply(`The list has locked, so this counts as a late drop. Still drop? Send \`${cmd}\`.`);
    }

    const r = await dropQuietly(this.deps.data, p.event.id, who.member!.id, lists.map((l) => l.id), this.now);
    if (r.dropped.length === 0) return reply(`You're not on ${f.day(p)}.`);
    const names = r.dropped.map((d) => `*${d.list}*`).join(" and ");
    const tail = r.dropped.some((d) => d.late) ? " It was a late drop, so nobody moves up on their own." : "";
    const name = who.member?.name ?? who.name ?? "Someone";
    const items: ChangeItem[] = r.dropped.map((d) => ({ kind: "out", name, list: d.list, ...(d.late ? { late: true } : {}) }));
    return this.withPromotions(p, `Done: you're off ${names} for ${f.day(p)}.${tail}`, r.promoted, items);
  }

  // Phase 5: free-text questions (Gemini) -----------------------------------------

  private async free(text: string, req: Request): Promise<Out[]> {
    if (!this.deps.ai) return reply(`Sorry, I didn't get that.\n\n${this.help(req.asker, true)}`);
    const practices = await this.deps.data.upcoming(this.now, 14);
    const memory = this.deps.memory;
    const weather = await this.forecasts(practices);
    const r = await ask(this.deps.ai, text, practices, req.asker, this.deps.features, this.now, undefined, memory?.forPrompt(chatOf(req), senderOf(req)) ?? "", !!req.replyToBot, weather, this.deps.faq ?? "");
    if (r.kind === "silent") return [];
    if (r.kind === "text") {
      memory?.remember(chatOf(req), senderOf(req), text, r.text);
      return reply(r.text);
    }
    // The same door as a typed command, so the same checks. Never back into Gemini.
    if (r.command.kind === "free") return reply("Sorry, I didn't get that. Try `!help`.");
    memory?.remember(chatOf(req), senderOf(req), text, `(ran ${typed(r.command)} and showed the result)`);
    return this.exec(r.command, req);
  }

  /** Forecasts for these practices by event id; none if the weather service is down. */
  private async forecasts(practices: Practice[]) {
    const out = new Map<string, string>();
    const weather = this.deps.weather;
    if (!weather) return out;
    try {
      for (const p of practices) {
        const f = await weather.at(p.event.starts_at);
        if (f) out.set(p.event.id, f);
      }
    } catch {
      // No forecast is better than no answer.
    }
    return out;
  }

  // Phase 4: running a practice (board) -------------------------------------------

  /** The board member and practice for a board command, or a message saying why not. */
  private async boardTarget(selector: string, req: Request): Promise<{ who: Asker; p: Practice } | Out[]> {
    const who = this.needBoard(req.asker);
    if (typeof who === "string") return reply(who);
    const p = await this.find(selector);
    if (typeof p === "string") return reply(p);
    return { who, p };
  }

  /** The app's "Open sign-ups" button (open_event). */
  private async open(selector: string, req: Request): Promise<Out[]> {
    const who = this.needBoard(req.asker);
    if (typeof who === "string") return reply(who);
    const p = await this.findOr(selector, isNotOpenYet, "Every upcoming practice is already open.");
    if (typeof p === "string") return reply(p);
    const sel = selector || selectorFor(p.event.starts_at, this.now);
    if (p.stage === "cancelled" || p.stage === "past") return reply(`${f.day(p)} is ${p.stage === "past" ? "over" : "cancelled"}.`);
    if (p.stage !== "soon" && p.stage !== "waiting") return reply(`Sign-ups for ${f.day(p)} are already open.`);
    await this.deps.data.openEvent(p.event.id);
    const post = this.deps.features.has("post") ? ` Post it with \`!post ${sel}\`.` : "";
    return reply(`Sign-ups for ${f.day(p)} are open.${post}`);
  }

  /** cancel_event, after a "yes" from the same board member in the same chat. */
  private async cancel(selector: string, reason: string, confirm: boolean, req: Request): Promise<Out[]> {
    const t = await this.boardTarget(selector, req);
    if (Array.isArray(t)) return t;
    const { who, p } = t;
    if (p.stage === "cancelled") return reply(`${f.day(p)} is already cancelled.`);
    if (p.stage === "past") return reply(`${f.day(p)} is over.`);
    const key = `${req.chatKey}|cancel|${p.event.id}`;
    const now = this.now.getTime();
    if (!confirm) {
      this.pending.set(key, reason, now);
      const count = new Set(p.lists.flatMap((l) => [...l.main, ...l.waitlist].map((s) => s.member_id))).size;
      const why = reason ? ` Reason: "${reason}".` : "";
      return reply(`Cancel ${f.day(p)}? I'll post it in the group (${f.players(count)} signed up).${why}\nSend \`!cancel ${selector} yes\` within 10 minutes to confirm.`);
    }
    const why = (reason || this.pending.take(key, now) || "").slice(0, 300);
    const n = await cancelQuietly(this.deps.data, p.event.id, why, who.board!.id, this.now);
    // One message for the whole group; no @mentions.
    const lines = [`*${p.event.title}, ${f.day(p)}, is cancelled.*`];
    if (why) lines.push(`Reason: ${why}`);
    lines.push(n ? `${f.players(n)} ${n === 1 ? "was" : "were"} signed up; nobody needs to drop out.` : "Nobody was signed up yet.");
    return [{ text: lines.join("\n"), quote: false }];
  }

  /** add_signup for a walk-in: "Jane Doe [list] [waitlist]". */
  private async add(selector: string, rest: string, req: Request): Promise<Out[]> {
    const t = await this.boardTarget(selector, req);
    if (Array.isArray(t)) return t;
    const { who, p } = t;
    if (p.stage === "cancelled" || p.stage === "past") return reply(`${f.day(p)} is ${p.stage === "past" ? "over" : "cancelled"}.`);

    let words = rest.trim().split(/\s+/).filter(Boolean);
    let spot: "main" | "waitlist" = "main";
    if (words.length && /^(waitlist|waiting|wl)$/i.test(words.at(-1)!)) {
      spot = "waitlist";
      words = words.slice(0, -1);
    }
    let list = p.lists.length === 1 ? p.lists[0] : null;
    const named = [...p.lists]
      .sort((a, b) => b.name.length - a.name.length)
      .find((l) => words.join(" ").toLowerCase().endsWith(` ${l.name.toLowerCase()}`));
    if (named) {
      list = named;
      words = words.slice(0, words.length - named.name.split(/\s+/).length);
    }
    const name = words.join(" ");
    if (name.length < 2) return reply(`Who should I add? \`!add ${selector} Jane Doe${p.lists.length > 1 ? ` ${p.lists[0].name.toLowerCase()}` : ""}\` (add \`waitlist\` for the waitlist).`);
    if (name.length > 80) return reply("That name is too long.");
    if (!list) return reply(`Which list? ${f.listChoices(p)}. Send \`!add ${selector} ${name} ${p.lists[0].name.toLowerCase()}\`.`);

    const r = await addQuietly(this.deps.data, p.event.id, list.id, name, spot, who.board!.id, this.now);
    const where = r.spot === "main" ? "the main list" : "the waitlist";
    const over = r.spot === "main" && list.main.length + 1 > list.cap ? ` That's ${list.main.length + 1} of ${list.cap}.` : "";
    const position = (r.spot === "main" ? list.main.length : list.waitlist.length) + 1;
    const item: ChangeItem = { kind: r.spot === "main" ? "in" : "wait", name, list: list.name, position };
    return this.withPromotions(p, `Added *${name}* to ${where} for *${list.name}*, ${f.day(p)}.${over}`, r.promoted, [item]);
  }

  /** shuffle_teams, then the draft teams. Sending them stays in the app. */
  private async teams(selector: string, req: Request): Promise<Out[]> {
    const t = await this.boardTarget(selector, req);
    if (Array.isArray(t)) return t;
    const { p } = t;
    if (!p.lists.some((l) => l.makes_teams)) return reply(`${f.day(p)} has no list that makes teams.`);
    if (p.stage === "cancelled" || p.stage === "past") return reply(`${f.day(p)} is ${p.stage === "past" ? "over" : "cancelled"}.`);
    if (!p.lists.some((l) => l.makes_teams && l.main.length > 0)) return reply("Nobody's on the list yet.");
    await this.deps.data.shuffleTeams(p.event.id);
    const fresh = await this.deps.data.practice(p.event.id, this.now);
    return reply(`${f.teamsText(fresh!)}\n\n_Shuffled, not sent yet._ Tweak and send them in the app: ${this.deps.siteUrl}/admin/p/${p.event.slug}/teams`);
  }

  /** Why nobody can sign up for this practice right now, or null if they can. */
  private closedFor(p: Practice, what: string) {
    switch (p.stage) {
      case "cancelled":
        return `${f.day(p)} is cancelled.`;
      case "past":
        return `${f.day(p)} is over.`;
      case "locked":
      case "teams":
        return `Sorry, the list for ${f.day(p)} has locked. Sign-ups close 2 hours before kickoff.`;
      case "soon":
      case "waiting":
        return `You can't ${what} for ${f.day(p)} yet. ${f.stageLine(p, this.now)}.`;
      default:
        return null;
    }
  }

  /** Runs a write and turns database errors into plain words. */
  private async write(fn: () => Promise<Out[]>): Promise<Out[]> {
    try {
      return await fn();
    } catch (err) {
      const text = friendly(err);
      if (!text) throw err;
      return reply(text);
    }
  }

  /** The reply, a line for everyone who moved up (an @mention if they linked WhatsApp, else their name), and the new list. */
  private async withPromotions(p: Practice, text: string, promoted: Promotion[], items: ChangeItem[]): Promise<Out[]> {
    const mentions: string[] = [];
    const lines = promoted.map((x) => {
      const jid = this.deps.mentionFor?.(x.email) ?? null;
      if (jid) mentions.push(jid);
      items.push({ kind: "up", name: x.name, list: x.list, position: x.position, ...(jid ? { mention: jid } : {}) });
      const who = jid ? `@${jid.split("@")[0]}` : `*${x.name}*`;
      return `⬆️ ${who} moves up from the waitlist: in for *${x.list}* (#${x.position} of ${x.cap}).`;
    });
    return [{ ...this.listOut(await this.fresh(p), [text, ...lines].join("\n"), mentions), change: { eventId: p.event.id, items } }];
  }

  // Helpers -----------------------------------------------------------------------

  /**
   * The practice a selector means or, with no selector, the first upcoming one
   * `pick` accepts (`none` says why there isn't one). Most weeks only one
   * practice is open, so "!in" alone just works.
   */
  async findOr(selector: string, pick: (p: Practice) => boolean, none: string): Promise<Practice | string> {
    if (selector) return this.find(selector);
    return (await this.deps.data.upcoming(this.now, 14)).find(pick) ?? none;
  }

  /** The practice a selector means, or a message saying why there isn't one. */
  async find(selector: string): Promise<Practice | string> {
    if (!selector) return "Which practice? Add a day, like `thu`, `next` or `10/23`.";
    const p = pickPractice(selector, await this.deps.data.upcoming(this.now, 14), this.now);
    return p ?? `I can't find a practice for "${selector}". Send \`!week\` to see what's coming up.`;
  }

  /** The asker if they're on the board, or why not. */
  needBoard(asker: Asker | null): Asker | string {
    const who = this.needMember(asker);
    if (typeof who === "string") return who;
    return who.board ? who : "Only the board can do that.";
  }

  /** The asker, or the message telling an unknown sender how to link. */
  needMember(asker: Asker | null): Asker | string {
    if (asker) return asker;
    const how = this.deps.botPhone ? `tap ${linkUrl(this.deps.botPhone)} to message me and send "link"` : "send me a private message saying `link`";
    return `I'm The List's bot and I don't know your WhatsApp yet. To connect it to your sign-ups (once, takes a minute), ${how}. I'll email you a code to check it's you, then try again here.`;
  }
}
