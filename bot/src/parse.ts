import { parseSelector, splitSelector } from "./pick";

// Turning a message into a command. Only messages that start with "!" and a
// command word (any case), or @mention the bot, get this far; see triggerBody().

export type Command =
  | { kind: "week" }
  | { kind: "help" }
  /** The practice's full list, with names. An empty practice means the next one. */
  | { kind: "list"; practice: string }
  | { kind: "me" }
  | { kind: "post"; practice: string }
  | { kind: "in"; practice: string; lists: string }
  | { kind: "out"; practice: string; lists: string; confirm: boolean }
  | { kind: "open"; practice: string }
  | { kind: "cancel"; practice: string; reason: string; confirm: boolean }
  | { kind: "add"; practice: string; rest: string }
  | { kind: "teams"; practice: string }
  | { kind: "free"; text: string };

const KEYWORDS: Record<string, Command["kind"]> = {
  list: "list",
  who: "list",
  week: "week",
  upcoming: "week",
  practices: "week",
  help: "help",
  me: "me",
  my: "me",
  mine: "me",
  status: "me",
  post: "post",
  in: "in",
  join: "in",
  signup: "in",
  out: "out",
  drop: "out",
  open: "open",
  cancel: "cancel",
  add: "add",
  teams: "teams",
  team: "teams",
};

/** The command word a message starts with ("in" for "In mon", "sign" + "up"), or null. */
function commandWord(text: string): Command["kind"] | null {
  const [first = "", second = ""] = text.trim().split(/\s+/);
  const word = first.toLowerCase().replace(/[.!?:,]+$/, "");
  if (word === "sign" && /^up\b/i.test(second)) return "in";
  return KEYWORDS[word] ?? null;
}

/**
 * What follows the "!", or null if the message isn't for the bot. Only real
 * commands count ("!in mon", "!LIST"), so "!!!" or "!nice" are ignored.
 * `mentionsBot` comes from WhatsApp; the adapter strips the @mention itself.
 */
export function triggerBody(text: string, mentionsBot: boolean): string | null {
  const t = text.trim();
  const bang = t.match(/^!\s*/);
  if (bang) {
    const body = t.slice(bang[0].length).trim();
    if (commandWord(body)) return body;
    return mentionsBot ? body : null;
  }
  return mentionsBot ? t : null;
}

/** Splits off a trailing "yes" (confirmations). */
function confirmTail(text: string) {
  const m = text.match(/^(.*?)\s*\byes[.!]*$/i);
  return m ? { text: m[1].trim(), confirm: true } : { text: text.trim(), confirm: false };
}

export function parseCommand(body: string): Command {
  let text = body.trim();
  // The old "!list in mon" form: "list" followed by another command.
  if (/^list\s/i.test(text) && commandWord(text.replace(/^list\s+/i, "")) && !/^list\s+list\b/i.test(text)) text = text.replace(/^list\s+/i, "");
  if (!text) return { kind: "week" };
  if (parseSelector(text)) return { kind: "list", practice: text };

  const [first, ...restWords] = text.split(/\s+/);
  let kind = KEYWORDS[first.toLowerCase().replace(/[.!?:,]+$/, "")];
  let rest = restWords.join(" ");
  if (!kind && /^sign$/i.test(first) && /^up\b/i.test(rest)) {
    kind = "in";
    rest = rest.replace(/^up\s*/i, "");
  }
  if (!kind) return { kind: "free", text };
  const bare = !rest || /^(please|pls)$/i.test(rest);
  if (kind === "help" || kind === "me" || kind === "week") return bare ? { kind } : { kind: "free", text };

  // A command with no practice still counts; the handler asks which (or, for !list, takes the next).
  const split = splitSelector(rest);
  if (!split && rest) return { kind: "free", text };
  const practice = split?.selector ?? "";
  const after = split?.rest ?? "";
  switch (kind) {
    case "in":
      return { kind, practice, lists: after };
    case "out": {
      const c = confirmTail(after);
      return { kind, practice, lists: c.text, confirm: c.confirm };
    }
    case "cancel": {
      const c = confirmTail(after);
      return { kind, practice, reason: c.text, confirm: c.confirm };
    }
    case "add":
      return { kind, practice, rest: after };
    case "list":
    case "post":
    case "open":
    case "teams":
      return after ? { kind: "free", text } : { kind, practice };
  }
  return { kind: "free", text };
}
