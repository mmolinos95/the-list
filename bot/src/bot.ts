import { ListBatcher, realTimers, type Batch, type Timers } from "./batch";
import type { Chat, IncomingMessage } from "./chat";
import { KeyedQueue } from "./chat";
import type { Commands, Out } from "./commands";
import type { Data } from "./data/types";
import { whoIs } from "./identity";
import { handleLinking, isLinkingMessage, type LinkingDeps } from "./linking";
import type { Mailer } from "./mailer";
import * as f from "./format";
import { parseCommand, triggerBody } from "./parse";
import type { LocalState } from "./state";

// The router: decides which messages get an answer, and runs them one at a
// time per chat. See BRIEF.md, "How it behaves in WhatsApp" and R1.
//
// Two queues per chat: one runs the work (database writes in arrival order),
// the other sends. Sending is paced (chat.ts), so it must never hold up the
// next write. List changes don't get their own reply: they're batched into one
// list message per practice (batch.ts).

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
  /** Timers for batching list messages; tests pass a fake clock. */
  timers?: Timers;
};

export class Bot {
  private queue = new KeyedQueue();
  private sends = new KeyedQueue();
  private batcher: ListBatcher;
  /** How many things are going on per chat; "typing…" shows while it's above zero. */
  private busy = new Map<string, number>();

  constructor(private deps: BotDeps) {
    this.batcher = new ListBatcher({ timers: deps.timers ?? realTimers, flush: (b) => this.flush(b) });
  }

  /** Handles one incoming message. Resolves when its reply (if any) is sent. */
  handle(msg: IncomingMessage): Promise<void> {
    if (this.deps.now() / 1000 - msg.timestamp > MAX_AGE_S) return Promise.resolve();

    if (msg.isGroup) {
      if (!msg.groupName || !this.deps.allowedGroups.includes(msg.groupName)) return Promise.resolve();
      const body = triggerBody(msg.text, msg.mentionsBot || !!msg.repliesToBot);
      if (body === null) return Promise.resolve();
      return this.answer(msg, () => this.groupCommand(msg, body));
    }

    // DMs: only the linking flow. Never anything else.
    if (!isLinkingMessage(msg.chatId, msg.text, this.deps.state)) return Promise.resolve();
    return this.answer(msg, () => this.linking(msg));
  }

  /**
   * Runs the work in the chat's queue, then hands its replies to the send queue
   * without waiting for them, so the next message's work can start. Resolves
   * when this message's own replies are sent (list changes go out later, batched).
   */
  private answer(msg: IncomingMessage, work: () => Promise<Out[]>): Promise<void> {
    let sent: Promise<void> = Promise.resolve();
    const done = this.queue.push(msg.chatId, async () => {
      this.hold(msg.chatId);
      let outs: Out[];
      try {
        outs = await work();
      } catch (err) {
        this.deps.log?.(`Failed to answer "${msg.text.slice(0, 80)}"`, err);
        outs = [{ text: "Sorry, something went wrong. Try again in a bit, or use the app.", quote: true }];
      }
      const now: Out[] = [];
      for (const o of outs) {
        if (o.change && msg.isGroup) {
          if (this.batcher.add(msg.chatId, o.change.eventId, o.change.items, msg)) this.hold(msg.chatId);
        } else now.push(o);
      }
      sent = this.sends.push(msg.chatId, async () => {
        for (const o of now) await this.send(msg.chatId, o, msg);
      });
      void sent.then(() => this.release(msg.chatId));
    });
    return done.then(() => sent);
  }

  /** Sends one message (quoted under `to` if asked) and keeps only the newest list of a practice. */
  private async send(chatId: string, o: Out, to: IncomingMessage | null) {
    const { chat } = this.deps;
    try {
      const id = o.quote && to ? await chat.reply(to, o.text, o.mentions) : await chat.send(chatId, o.text, o.mentions);
      if (o.listOf && id) {
        const old = this.deps.state.swapListPost(chatId, o.listOf, id);
        if (old) await chat.delete(chatId, old).catch((err) => this.deps.log?.("Couldn't delete an old list", err));
      }
    } catch (err) {
      this.deps.log?.("Failed to send a reply", err);
    }
  }

  /** Posts a batch of list changes: one message with what changed and the full list. */
  private async flush(b: Batch) {
    await this.sends.push(b.chatId, async () => {
      let out: Out | null;
      try {
        out = await this.deps.commands.changeMessage(b.eventId, b.items);
      } catch (err) {
        this.deps.log?.("Couldn't read the list for a batch", err);
        out = null;
      }
      // No list (the read failed): still say what changed.
      out ??= { text: f.changeSummary(b.items, new Set(b.items.map((x) => x.list)).size > 1).text, quote: true };
      // A lone change is quoted under the message that made it; a rush isn't quoted at all.
      await this.send(b.chatId, out, b.triggers.length === 1 ? b.triggers[0] : null);
    });
    this.release(b.chatId);
  }

  private hold(chatId: string) {
    const n = this.busy.get(chatId) ?? 0;
    this.busy.set(chatId, n + 1);
    if (n === 0) void this.deps.chat.typing(chatId, true).catch(() => undefined);
  }

  private release(chatId: string) {
    const n = (this.busy.get(chatId) ?? 1) - 1;
    if (n > 0) return void this.busy.set(chatId, n);
    this.busy.delete(chatId);
    void this.deps.chat.typing(chatId, false).catch(() => undefined);
  }

  private async groupCommand(msg: IncomingMessage, body: string) {
    const { data, state, commands } = this.deps;
    const asker = await whoIs(msg.senderIds, msg.senderPhone, data, state);
    const replyToBot = !!msg.repliesToBot && !msg.mentionsBot;
    return commands.run(parseCommand(body), { asker, chatKey: `${msg.chatId}|${msg.senderIds[0]}`, replyToBot });
  }

  private async linking(msg: IncomingMessage) {
    const deps: LinkingDeps = { data: this.deps.data, state: this.deps.state, mailer: this.deps.mailer, now: this.deps.now };
    const text = await handleLinking(msg.chatId, [msg.chatId, ...msg.senderIds], msg.text, deps, msg.senderPhone);
    return text ? [{ text, quote: false }] : [];
  }
}
