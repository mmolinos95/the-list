// The WhatsApp side, behind a small interface so commands and the router are
// tested without Baileys. whatsapp.ts is the Baileys implementation.

export type IncomingMessage = {
  id: string;
  /** Group or DM chat ID. */
  chatId: string;
  isGroup: boolean;
  /** The group's name (subject), for groups. */
  groupName?: string;
  /** Every ID WhatsApp gave for the sender: phone JID and/or hidden @lid. */
  senderIds: string[];
  /** The sender's phone (E.164) when WhatsApp shares it. */
  senderPhone: string | null;
  /** Text with any @mention of the bot removed. */
  text: string;
  mentionsBot: boolean;
  /** Seconds since epoch. */
  timestamp: number;
};

export interface Chat {
  /** Replies quoted under the message. `mentions` are WhatsApp IDs written as "@<number>" in the text. Resolves to the sent message's id. */
  reply(to: IncomingMessage, text: string, mentions?: string[]): Promise<string | null>;
  /** A plain message in a chat (the board's "!post", a cancellation notice). Resolves to the sent message's id. */
  send(chatId: string, text: string, mentions?: string[]): Promise<string | null>;
  /** Deletes one of the bot's own messages for everyone. */
  delete(chatId: string, msgId: string): Promise<void>;
  /** Shows or clears "typing…". */
  typing(chatId: string, on: boolean): Promise<void>;
}

export type PacerOptions = { minGapMs: number; perMinute: number; now?: () => number; sleep?: (ms: number) => Promise<void> };

/**
 * Spaces out the bot's own messages: at least `minGapMs` between any two, and
 * no more than `perMinute` in any minute. Messages wait their turn; none are dropped.
 */
export class Pacer {
  private sent: number[] = [];
  private chain: Promise<void> = Promise.resolve();
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;

  constructor(private opts: PacerOptions) {
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Runs `send` when the limits allow it. */
  run<T>(send: () => Promise<T>): Promise<T> {
    const result = this.chain.then(async () => {
      await this.sleep(this.waitMs());
      this.sent.push(this.now());
      return send();
    });
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** How long the next message has to wait. */
  waitMs() {
    const t = this.now();
    this.sent = this.sent.filter((s) => s > t - 60_000);
    const last = this.sent.at(-1);
    let wait = last === undefined ? 0 : Math.max(0, last + this.opts.minGapMs - t);
    if (this.sent.length >= this.opts.perMinute) wait = Math.max(wait, this.sent[this.sent.length - this.opts.perMinute] + 60_000 - t);
    return wait;
  }
}

/** Wraps a Chat so every message goes through the pacer. Typing isn't paced. */
export function pacedChat(chat: Chat, pacer: Pacer): Chat {
  return {
    reply: (to, text, mentions) => pacer.run(() => chat.reply(to, text, mentions)),
    send: (chatId, text, mentions) => pacer.run(() => chat.send(chatId, text, mentions)),
    delete: (chatId, msgId) => pacer.run(() => chat.delete(chatId, msgId)),
    typing: (chatId, on) => chat.typing(chatId, on),
  };
}

/** Runs tasks one at a time per key (one question at a time per chat). */
export class KeyedQueue {
  private tails = new Map<string, Promise<void>>();

  push(key: string, task: () => Promise<void>): Promise<void> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(task, task).catch(() => undefined);
    this.tails.set(key, next);
    void next.then(() => {
      if (this.tails.get(key) === next) this.tails.delete(key);
    });
    return next;
  }
}
