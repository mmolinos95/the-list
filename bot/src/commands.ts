import type { Feature } from "./config";
import type { Data, Practice } from "./data/types";
import * as f from "./format";
import type { Asker } from "./identity";
import type { Command } from "./parse";
import { linkUrl } from "./phone";
import { matchLists, pickPractice } from "./pick";
import { sharePost } from "./share";

// Runs a parsed command for someone. Every permission check lives here, so a
// command picked by Gemini (ai.ts) gets exactly the same checks as a typed one.

export type Out = { text: string; quote: boolean };

export type CommandDeps = {
  data: Data;
  features: Set<Feature>;
  botPhone: string | null;
  siteUrl: string;
  dropLinkSecret: string | null;
  now: () => Date;
  /** Called after any write, to send the emails it queued (outbox.ts). */
  afterWrite?: () => void;
};

export type Request = {
  asker: Asker | null;
  /** Where the confirmation of a two-step command must come from (chat + sender). */
  chatKey: string;
};

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

/** The feature each command needs. */
export const FEATURE_OF: Record<Command["kind"], Feature> = {
  overview: "read",
  help: "read",
  details: "read",
  me: "read",
  post: "post",
  in: "signup",
  out: "signup",
  open: "board",
  lock: "board",
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
    if (!this.deps.features.has(FEATURE_OF[cmd.kind])) {
      if (cmd.kind === "free") return reply(`Sorry, I didn't get that.\n\n${this.help(req.asker, true)}`);
      return reply("That isn't switched on yet. For now, use the app or ask the board.");
    }
    switch (cmd.kind) {
      case "overview":
        return this.overview(req);
      case "help":
        return reply(this.help(req.asker, false));
      case "details":
        return this.details(cmd.practice);
      case "me":
        return this.me(req);
      case "post":
        return this.post(cmd.practice, req);
      case "in":
        return this.write(() => this.signUp(cmd.practice, cmd.lists, req));
      case "out":
        return this.write(() => this.dropOut(cmd.practice, cmd.lists, cmd.confirm, req));
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
      const bits = ["`!list thu` details", "`!list me` your spots"];
      if (has("signup")) bits.push("`!list in thu` / `!list out thu`");
      if (has("ai")) bits.push("or just ask me");
      return `${bits.join(" · ")} · \`!list help\``;
    }
    const lines = [
      "*The List bot*",
      "`!list` upcoming practices",
      "`!list thu` one practice (also `next`, `tomorrow`, `10/23`)",
      "`!list me` your spots",
    ];
    if (has("signup")) lines.push("`!list in thu [list]` sign up", "`!list out thu [list]` drop out");
    if (has("ai")) lines.push("Or @mention me with a question.");
    if (asker?.board && (has("post") || has("board"))) {
      lines.push("", "*Board*");
      if (has("post")) lines.push("`!list post thu` post the sign-up message");
      if (has("board"))
        lines.push(
          "`!list open thu` open sign-ups now",
          "`!list cancel thu [reason]` cancel (asks to confirm)",
          "`!list add thu Name [list] [waitlist]` add a walk-in",
          "`!list teams thu` shuffle teams",
        );
    }
    return lines.join("\n");
  }

  private async details(selector: string): Promise<Out[]> {
    const p = await this.find(selector);
    if (typeof p === "string") return reply(p);
    return reply(f.details(p, this.now));
  }

  private async me(req: Request): Promise<Out[]> {
    const who = this.needMember(req.asker);
    if (typeof who === "string") return reply(who);
    if (!who.member) return reply("You're not on any list yet. Sign up with `!list in thu`.");
    const practices = await this.deps.data.upcoming(this.now, 14);
    const lines = f.mySpots(practices, who.member.id);
    return reply(lines.length ? `*Your spots*\n${lines.join("\n")}` : "You're not on any upcoming list.");
  }

  // Phase 2: the board's sign-up post ----------------------------------------------

  private async post(selector: string, req: Request): Promise<Out[]> {
    const who = this.needBoard(req.asker);
    if (typeof who === "string") return reply(who);
    if (!this.deps.dropLinkSecret) return reply("I can't make sign-up links: DROP_LINK_SECRET isn't set on the bot.");
    const p = await this.find(selector);
    if (typeof p === "string") return reply(p);
    if (p.stage === "cancelled") return reply(`${f.day(p)} is cancelled, so there's nothing to post.`);
    if (p.stage === "past") return reply(`${f.day(p)} is over.`);
    const out: Out[] = [{ text: sharePost(this.deps.dropLinkSecret, this.deps.siteUrl, p.event, p.lists), quote: false }];
    if (p.stage === "waiting") {
      const how = this.deps.features.has("board") ? ` Open them with \`!list open ${selector}\`.` : " Open them in the app.";
      out.push({ text: `Heads-up: sign-ups for ${f.day(p)} aren't open yet, so the link shows "opens soon".${how}`, quote: true });
    }
    return out;
  }

  // Phase 3: signing up and dropping out -------------------------------------------

  private async signUp(selector: string, listText: string, req: Request): Promise<Out[]> {
    const who = this.needMember(req.asker);
    if (typeof who === "string") return reply(who);
    if (!who.name) return reply("I need your name first. Send me `link` in a DM to set it up.");
    const p = await this.find(selector);
    if (typeof p === "string") return reply(p);
    const closed = this.closedFor(p, "sign up");
    if (closed) return reply(closed);

    let lists = p.lists;
    if (p.lists.length > 1 || listText) {
      const m = matchLists(listText, p.lists);
      if (m.unknown) return reply(`${f.day(p)} has no list called "${m.unknown}". Pick ${f.listChoices(p)}.`);
      if (m.lists.length === 0) {
        const names = p.lists.map((l) => `\`!list in ${selector} ${l.name.toLowerCase()}\``);
        return reply(`Which list? ${f.listChoices(p)}.\nSend ${names.join(", ")} or \`!list in ${selector} both\`.`);
      }
      lists = m.lists;
    }

    const r = await this.deps.data.signUp(p.event.id, lists.map((l) => l.id), who.name, who.email, who.phone);
    const order = (id: string) => p.lists.findIndex((l) => l.id === id);
    const lines = [...r.results].sort((a, b) => order(a.list_id) - order(b.list_id)).map((x) => {
      if (x.already) return x.spot === "main" ? `You're already on *${x.list}* (#${x.position} of ${x.cap}).` : `You're already #${x.position} on the *${x.list}* waitlist.`;
      if (x.spot === "main") return `You're in: *${x.list}*, #${x.position} of ${x.cap}.`;
      return `*${x.list}* is full. You're #${x.position} on the waitlist and move up on your own if a spot opens before the lock.`;
    });
    if (r.created) lines.push(`${f.day(p)}. Confirmation (with a drop-out link) is in your email.`);
    return reply(lines.join("\n"));
  }

  private async dropOut(selector: string, listText: string, confirm: boolean, req: Request): Promise<Out[]> {
    const who = this.needMember(req.asker);
    if (typeof who === "string") return reply(who);
    const p = await this.find(selector);
    if (typeof p === "string") return reply(p);
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

    // After the lock a drop is a late drop (the board is told), so ask first.
    const late = this.now.getTime() >= Date.parse(p.event.locks_at) && lists.some((l) => l.main.some((s) => s.member_id === who.member!.id));
    const key = `${req.chatKey}|out|${p.event.id}`;
    if (late && !(confirm || this.pending.take(key, this.now.getTime()))) {
      this.pending.set(key, "yes", this.now.getTime());
      const cmd = `!list out ${selector}${listText ? ` ${listText}` : ""} yes`;
      return reply(`The list has locked, so this counts as a late drop and the board is told. Still drop? Send \`${cmd}\`.`);
    }

    const r = await this.deps.data.drop(p.event.id, who.member!.id, lists.map((l) => l.id));
    if (r.dropped.length === 0) return reply(`You're not on ${f.day(p)}.`);
    const names = r.dropped.map((d) => `*${d.list}*`).join(" and ");
    const tail = r.dropped.some((d) => d.late) ? " The list had locked, so the board was told." : r.dropped.some((d) => d.spot === "main") ? " Your spot went to the next person on the waitlist, if there was one." : "";
    return reply(`Done: you're off ${names} for ${f.day(p)}.${tail}`);
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

  /** Runs a write, sends its emails, and turns database errors into plain words. */
  private async write(fn: () => Promise<Out[]>): Promise<Out[]> {
    try {
      return await fn();
    } catch (err) {
      const text = friendly(err);
      if (!text) throw err;
      return reply(text);
    } finally {
      this.deps.afterWrite?.();
    }
  }

  // Helpers -----------------------------------------------------------------------

  /** The practice a selector means, or a message saying why there isn't one. */
  async find(selector: string): Promise<Practice | string> {
    if (!selector) return "Which practice? Add a day, like `thu`, `next` or `10/23`.";
    const p = pickPractice(selector, await this.deps.data.upcoming(this.now, 14), this.now);
    return p ?? `I can't find a practice for "${selector}". Send \`!list\` to see what's coming up.`;
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
    const how = this.deps.botPhone ? `Tap ${linkUrl(this.deps.botPhone)} and send the message` : "Send me a DM saying `link`";
    return `I don't know who you are yet. ${how} to link your WhatsApp (takes a minute), then try again here.`;
  }
}
