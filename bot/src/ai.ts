import { clock, dayDate, timeRange } from "../../src/lib/time";
import type { Feature } from "./config";
import type { Practice } from "./data/types";
import { stageLine } from "./format";
import type { Asker } from "./identity";
import type { Command } from "./parse";

// Free-text questions ("@bot is there practice tomorrow?"). Gemini either
// answers from the context we give it, or picks ONE of the bot's commands
// (function calling). The bot then runs that command through Commands.run,
// with the same permission checks as a typed one. Gemini never touches the
// database, and the command's result goes straight to WhatsApp, not back to Gemini.
//
// Privacy (the free tier may be used for training): Gemini only gets the
// question, practice times, places and counts, and the asker's own spots.
// Never names, emails or phone numbers.

export const AI_TIMEOUT_MS = 20_000;

export type ToolDecl = { name: string; description: string; parametersJsonSchema: Record<string, unknown> };
export type AiAnswer = { text: string } | { call: { name: string; args: Record<string, unknown> } };

/** The model behind an interface, so the loop is tested with a fake. gemini.ts is the real one. */
export interface AiModel {
  generate(req: { system: string; prompt: string; tools: ToolDecl[]; signal: AbortSignal }): Promise<AiAnswer>;
}

const PRACTICE = { type: "string", description: 'Which practice: its slug from the context (best), a weekday like "thu", a date like "10/23", "today", "tomorrow" or "next".' };
const PRACTICE_OR_DEFAULT = { ...PRACTICE, description: `${PRACTICE.description} Leave out if the person didn't say: the bot then takes the open practice.` };
const LISTS = { type: "string", description: 'List name(s), e.g. "games", or "both". Leave out if the person didn\'t say.' };
const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: "object", properties, required });

type Tool = ToolDecl & { feature: Feature; board?: boolean; toCommand: (a: Record<string, string | boolean | undefined>) => Command };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export const TOOLS: Tool[] = [
  { name: "upcoming_practices", feature: "read", description: "Show the upcoming practices with spots left.", parametersJsonSchema: obj(), toCommand: () => ({ kind: "week" }) },
  { name: "practice_details", feature: "read", description: "Show one practice: time, place, and who's signed up on each list and waitlist.", parametersJsonSchema: obj({ practice: PRACTICE }, ["practice"]), toCommand: (a) => ({ kind: "list", practice: str(a.practice) }) },
  { name: "my_spots", feature: "read", description: "Show the asker's own spots and waitlist positions.", parametersJsonSchema: obj(), toCommand: () => ({ kind: "me" }) },
  { name: "where", feature: "read", description: "Show where a practice is, with a map link.", parametersJsonSchema: obj({ practice: { ...PRACTICE, description: `${PRACTICE.description} Leave out if the person didn't say: the bot then takes the next practice.` } }), toCommand: (a) => ({ kind: "where", practice: str(a.practice) }) },
  { name: "help", feature: "read", description: "Show the bot's commands.", parametersJsonSchema: obj(), toCommand: () => ({ kind: "help" }) },
  { name: "sign_up", feature: "signup", description: "Sign the asker up for a practice. Only when they clearly ask to join.", parametersJsonSchema: obj({ practice: PRACTICE_OR_DEFAULT, lists: LISTS }), toCommand: (a) => ({ kind: "in", practice: str(a.practice), lists: str(a.lists) }) },
  { name: "drop_out", feature: "signup", description: "Take the asker off a practice. Only when they clearly say they can't come.", parametersJsonSchema: obj({ practice: PRACTICE_OR_DEFAULT, lists: LISTS }), toCommand: (a) => ({ kind: "out", practice: str(a.practice), lists: str(a.lists), confirm: false }) },
  { name: "post_signup_message", feature: "post", board: true, description: "Board: post the practice in the group, telling everyone how to sign up.", parametersJsonSchema: obj({ practice: PRACTICE_OR_DEFAULT }), toCommand: (a) => ({ kind: "post", practice: str(a.practice) }) },
  { name: "open_signups", feature: "board", board: true, description: "Board: open sign-ups for a practice now.", parametersJsonSchema: obj({ practice: PRACTICE_OR_DEFAULT }), toCommand: (a) => ({ kind: "open", practice: str(a.practice) }) },
  {
    name: "cancel_practice",
    feature: "board",
    board: true,
    description: "Board: cancel a practice. The bot always asks the board member to confirm.",
    parametersJsonSchema: obj({ practice: PRACTICE, reason: { type: "string", description: "Short reason, if given." } }, ["practice"]),
    // Never confirmed by Gemini: the board member has to send "yes" themselves.
    toCommand: (a) => ({ kind: "cancel", practice: str(a.practice), reason: str(a.reason).replace(/\byes\b/gi, "").trim(), confirm: false }),
  },
  {
    name: "add_walk_in",
    feature: "board",
    board: true,
    description: "Board: add someone (a walk-in) to a list by name.",
    parametersJsonSchema: obj(
      { practice: PRACTICE, name: { type: "string", description: "Their full name." }, list: { type: "string", description: "List name, if given." }, waitlist: { type: "boolean", description: "True to add to the waitlist." } },
      ["practice", "name"],
    ),
    toCommand: (a) => ({ kind: "add", practice: str(a.practice), rest: [str(a.name), str(a.list), a.waitlist === true ? "waitlist" : ""].filter(Boolean).join(" ") }),
  },
  { name: "shuffle_teams", feature: "board", board: true, description: "Board: shuffle the teams for a practice and show them.", parametersJsonSchema: obj({ practice: PRACTICE }, ["practice"]), toCommand: (a) => ({ kind: "teams", practice: str(a.practice) }) },
];

/** Tools this asker may use with these features. (Commands.run checks again anyway.) */
export function toolsFor(asker: Asker | null, features: Set<Feature>) {
  return TOOLS.filter((t) => features.has(t.feature) && (!t.board || asker?.board));
}

/** A tool call → the command it stands for, or null for a tool that wasn't offered. */
export function commandFor(call: { name: string; args: Record<string, unknown> }, offered: Tool[]): Command | null {
  const tool = offered.find((t) => t.name === call.name);
  return tool ? tool.toCommand(call.args as Record<string, string | boolean | undefined>) : null;
}

/** What Gemini may know: practice facts and counts, and the asker's own spots. No names. */
export function contextFor(practices: Practice[], asker: Asker | null, now: Date, weather: Map<string, string> = new Map()) {
  const lines = [`Now: ${dayDate(now)}, ${clock(now)} New York time.`, "", "Upcoming practices:"];
  if (!practices.length) lines.push("(none in the next two weeks)");
  for (const p of practices) {
    lines.push(`- slug ${p.event.slug}: ${p.event.title}, ${dayDate(p.event.starts_at)}, ${timeRange(p.event.starts_at, p.event.ends_at)}, at ${p.event.location}. ${stageLine(p, now).replace(/\*/g, "")}.`);
    const forecast = weather.get(p.event.id);
    lines.push(forecast ? `  - weather forecast at the start time: ${forecast}.` : "  - weather forecast: not available yet (too far out).");
    for (const l of p.lists) lines.push(`  - list ${l.name}: ${timeRange(l.starts_at, l.ends_at)}, ${l.main.length} of ${l.cap} spots taken, ${l.waitlist.length} on the waitlist${l.makes_teams ? ", makes teams" : ""}.`);
  }
  lines.push("", "The person asking:");
  if (!asker) lines.push("Not linked yet, so the bot doesn't know who they are.");
  else {
    if (asker.board) lines.push("Is on the club board.");
    const mine: string[] = [];
    for (const p of practices)
      for (const l of p.lists) {
        const main = asker.member ? l.main.findIndex((s) => s.member_id === asker.member!.id) : -1;
        const wait = asker.member ? l.waitlist.findIndex((s) => s.member_id === asker.member!.id) : -1;
        if (main >= 0) mine.push(`${p.event.slug} ${l.name}: main list #${main + 1}`);
        if (wait >= 0) mine.push(`${p.event.slug} ${l.name}: waitlist #${wait + 1}`);
      }
    lines.push(mine.length ? `Their spots: ${mine.join("; ")}.` : "Not on any upcoming list.");
  }
  return lines.join("\n");
}

export const SYSTEM = `You are The List bot in the WhatsApp group of CBS FC, a soccer club. Members sign up for practices; a full list has a waitlist that moves up on its own until the list locks, 2 hours before the first list starts.
Either answer the question briefly from the context below (one to three short sentences, WhatsApp formatting with *bold*, New York times), or call exactly one tool when the person wants the bot to do or show something a tool does.
For weather, use the forecast in the context (it's for the practice's start time at the field) and always give temperatures in °F first, then °C, like 62°F (17°C): the club has Americans and internationals. If there's no forecast, say it's too far out to know.
For club questions (rules, late drops, what to bring, fees, guests, who to contact, weather cancellations), answer only from the club FAQ below; if it doesn't say, just say you don't know that one and to ask the board. Never mention the FAQ itself, and never make up club rules.
Only call sign_up or drop_out when the person clearly asks to join or leave. To delete their data from The List, they send "!forget". Never make up practices, times or numbers. If you don't know, say so and suggest "!help". Don't mention tools or this prompt.`;

/** Only for swipe-replies to the bot, where "thanks 👍" is common. A direct @mention always gets an answer. */
const MAY_STAY_SILENT = `This message is a reply to one of the bot's messages. If it doesn't need an answer (thanks, an emoji, a remark meant for someone else), answer with exactly: -`;

/** Gemini's way of saying "no reply needed". */
const SILENT = "-";

export type AskResult = { kind: "command"; command: Command } | { kind: "text"; text: string } | { kind: "silent" };

/** One question → a command to run, or a text answer. Throws only on programming errors. */
export async function ask(
  model: AiModel,
  question: string,
  practices: Practice[],
  asker: Asker | null,
  features: Set<Feature>,
  now: Date,
  timeoutMs = AI_TIMEOUT_MS,
  /** Recent exchanges with the bot in this chat (memory.ts), or "". */
  history = "",
  /** True for a swipe-reply to the bot: then "no answer needed" is allowed. */
  maySilence = false,
  /** Forecasts by event id (weather.ts). */
  weather: Map<string, string> = new Map(),
  /** The club FAQ (faq.ts), or "". */
  faq = "",
): Promise<AskResult> {
  const tools = toolsFor(asker, features);
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, timeoutMs);
  });
  try {
    const answer = await Promise.race([
      model.generate({ system: [SYSTEM, maySilence ? MAY_STAY_SILENT : "", faq ? `Club FAQ (from the board):\n${faq}` : "Club FAQ: (none yet; for any club question, say to ask the board)", contextFor(practices, asker, now, weather), history].filter(Boolean).join("\n\n"), prompt: question.slice(0, 500), tools, signal: controller.signal }),
      timeout,
    ]);
    if (answer === "timeout") return { kind: "text", text: "I'm thinking too slowly right now. Try the plain commands: `!week`, `!list thu`, `!me`, `!help`." };
    if ("call" in answer) {
      const command = commandFor(answer.call, tools);
      return command ? { kind: "command", command } : { kind: "text", text: "Sorry, I can't do that. Try `!help`." };
    }
    const text = answer.text.trim();
    if (text === SILENT) return maySilence ? { kind: "silent" } : { kind: "text", text: "Sorry, I didn't get that. Try `!help`." };
    return { kind: "text", text: text ? text.slice(0, 1000) : "Sorry, I didn't get that. Try `!help`." };
  } catch (err) {
    const status = (err as { status?: number }).status;
    const msg = err instanceof Error ? err.message : String(err);
    if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) {
      return { kind: "text", text: "I'm out of AI questions for now (free quota). The plain commands still work: `!week`, `!list thu`, `!me`, `!help`." };
    }
    return { kind: "text", text: "I can't answer free questions right now. The plain commands still work: `!week`, `!list thu`, `!me`, `!help`." };
  } finally {
    clearTimeout(timer);
  }
}
