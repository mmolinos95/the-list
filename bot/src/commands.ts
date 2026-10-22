import type { Feature } from "./config";
import type { Data, Practice } from "./data/types";
import * as f from "./format";
import type { Asker } from "./identity";
import type { Command } from "./parse";
import { linkUrl } from "./phone";
import { pickPractice } from "./pick";

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
};

export type Request = {
  asker: Asker | null;
  /** Where the confirmation of a two-step command must come from (chat + sender). */
  chatKey: string;
};

const reply = (text: string): Out[] => [{ text, quote: true }];

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

  // Helpers -----------------------------------------------------------------------

  /** The practice a selector means, or a message saying why there isn't one. */
  async find(selector: string): Promise<Practice | string> {
    if (!selector) return "Which practice? Add a day, like `thu`, `next` or `10/23`.";
    const p = pickPractice(selector, await this.deps.data.upcoming(this.now, 14), this.now);
    return p ?? `I can't find a practice for "${selector}". Send \`!list\` to see what's coming up.`;
  }

  /** The asker, or the message telling an unknown sender how to link. */
  needMember(asker: Asker | null): Asker | string {
    if (asker) return asker;
    const how = this.deps.botPhone ? `Tap ${linkUrl(this.deps.botPhone)} and send the message` : "Send me a DM saying `link`";
    return `I don't know who you are yet. ${how} to link your WhatsApp (takes a minute), then try again here.`;
  }
}
