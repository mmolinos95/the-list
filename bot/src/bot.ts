import type { Chat, IncomingMessage } from "./chat";
import { KeyedQueue } from "./chat";
import type { Commands } from "./commands";
import type { Data } from "./data/types";
import { whoIs } from "./identity";
import { handleLinking, isLinkingMessage, type LinkingDeps } from "./linking";
import type { Mailer } from "./mailer";
import { parseCommand, triggerBody } from "./parse";
import type { LocalState } from "./state";

// The router: decides which messages get an answer, and runs them one at a
// time per chat. See BRIEF.md, "How it behaves in WhatsApp".

/** Messages older than this (e.g. a backlog after a reconnect) are ignored. */
export const MAX_AGE_S = 5 * 60;

export type BotDeps = {
  chat: Chat;
  data: Data;
  state: LocalState;
  mailer: Mailer;
  commands: Commands;
  allowedGroups: string[];
  now: () => number;
  log?: (msg: string, err?: unknown) => void;
};

export class Bot {
  private queue = new KeyedQueue();

  constructor(private deps: BotDeps) {}

  /** Handles one incoming message. Resolves when its reply (if any) is sent. */
  handle(msg: IncomingMessage): Promise<void> {
    if (this.deps.now() / 1000 - msg.timestamp > MAX_AGE_S) return Promise.resolve();

    if (msg.isGroup) {
      if (!msg.groupName || !this.deps.allowedGroups.includes(msg.groupName)) return Promise.resolve();
      const body = triggerBody(msg.text, msg.mentionsBot);
      if (body === null) return Promise.resolve();
      return this.queue.push(msg.chatId, () => this.answer(msg, () => this.groupCommand(msg, body)));
    }

    // DMs: only the linking flow. Never anything else.
    if (!isLinkingMessage(msg.chatId, msg.text, this.deps.state)) return Promise.resolve();
    return this.queue.push(msg.chatId, () => this.answer(msg, () => this.linking(msg)));
  }

  private async answer(msg: IncomingMessage, work: () => Promise<{ text: string; quote: boolean }[]>) {
    const { chat } = this.deps;
    try {
      await chat.typing(msg.chatId, true);
      let outs: { text: string; quote: boolean }[];
      try {
        outs = await work();
      } catch (err) {
        this.deps.log?.(`Failed to answer "${msg.text.slice(0, 80)}"`, err);
        outs = [{ text: "Sorry, something went wrong. Try again in a bit, or use the app.", quote: true }];
      }
      await chat.typing(msg.chatId, false);
      for (const o of outs) {
        if (o.quote) await chat.reply(msg, o.text);
        else await chat.send(msg.chatId, o.text);
      }
    } catch (err) {
      this.deps.log?.("Failed to send a reply", err);
    }
  }

  private async groupCommand(msg: IncomingMessage, body: string) {
    const { data, state, commands } = this.deps;
    const asker = await whoIs(msg.senderIds, msg.senderPhone, data, state);
    return commands.run(parseCommand(body), { asker, chatKey: `${msg.chatId}|${msg.senderIds[0]}` });
  }

  private async linking(msg: IncomingMessage) {
    const deps: LinkingDeps = { data: this.deps.data, state: this.deps.state, mailer: this.deps.mailer, now: this.deps.now };
    const text = await handleLinking(msg.chatId, [msg.chatId, ...msg.senderIds], msg.text, deps);
    return text ? [{ text, quote: false }] : [];
  }
}
