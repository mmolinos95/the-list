// What Gemini remembers: the last few exchanges with the bot in each chat, so
// a follow-up ("and Friday?") makes sense. Only messages to the bot are kept,
// never the rest of the group chat. The bot's side is Gemini's own answer or a
// note of the command that ran, never a command's output, so names on a list
// never reach Gemini. Kept in memory only: a restart forgets it.

export const MEMORY_SIZE = 6;
export const MEMORY_MS = 30 * 60_000;

type Entry = { at: number; sender: string; user: string; bot: string };

export class ChatMemory {
  private chats = new Map<string, Entry[]>();

  constructor(private now: () => number = Date.now) {}

  remember(chatId: string, sender: string, user: string, bot: string) {
    const kept = this.recent(chatId);
    kept.push({ at: this.now(), sender, user: user.slice(0, 300), bot: bot.slice(0, 300) });
    this.chats.set(chatId, kept.slice(-MEMORY_SIZE));
  }

  /** Forgets everything this sender said to the bot, in every chat (!forget). */
  forget(sender: string) {
    for (const [chatId, entries] of this.chats) this.chats.set(chatId, entries.filter((e) => e.sender !== sender));
  }

  /** The recent exchanges as lines for Gemini, oldest first; "" if there are none. */
  forPrompt(chatId: string, sender: string) {
    const lines = this.recent(chatId).map((e) => `- ${e.sender === sender ? "The person asking now" : "Someone else"}: "${e.user}" → bot: ${e.bot}`);
    return lines.length ? `Recent messages to the bot in this chat (oldest first):\n${lines.join("\n")}` : "";
  }

  private recent(chatId: string) {
    return (this.chats.get(chatId) ?? []).filter((e) => this.now() - e.at < MEMORY_MS);
  }
}
