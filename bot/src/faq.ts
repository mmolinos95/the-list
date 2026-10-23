import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The club FAQ (bot/FAQ.md), which the board fills in. It goes into Gemini's
// context so it can answer club questions; Gemini answers those only from it
// and says "ask the board" otherwise (ai.ts). Club info only, no member data.

export const FAQ_PATH = resolve(import.meta.dirname, "../FAQ.md");

const PLACEHOLDER = /\(board: fill in\)/i;

/**
 * The FAQ as Gemini should see it: without the comment for the board, without
 * lines still saying "(board: fill in)", and without sections left empty. A
 * missing, empty or still blank template gives just the facts that are filled in.
 */
export function faqText(raw: string): string {
  const lines = raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter((l) => !PLACEHOLDER.test(l));
  const sections: { head: string | null; body: string[] }[] = [{ head: null, body: [] }];
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) sections.push({ head: line, body: [] });
    else sections.at(-1)!.body.push(line);
  }
  return sections
    .filter((s) => s.body.some((l) => l.trim()))
    .map((s) => [s.head, ...s.body].filter((l): l is string => l !== null).join("\n").trim())
    .join("\n\n");
}

/** Reads the FAQ file; "" if it's missing or unreadable. Read once, at start. */
export function loadFaq(path = FAQ_PATH): string {
  try {
    return faqText(readFileSync(path, "utf8"));
  } catch {
    return "";
  }
}
