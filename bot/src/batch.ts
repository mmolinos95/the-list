import type { IncomingMessage } from "./chat";
import type { ChangeItem } from "./format";

// Rush handling (BRIEF.md, R1). When sign-ups open, 30–40 people send `!in`
// within a minute or two. Each write still runs right away, in arrival order;
// only the list message is batched, per practice per chat: the first change
// schedules one post, which goes out after QUIET_MS with no further change, or
// MAX_MS after the first change at the latest. A lone change takes the same path.

export const QUIET_MS = 5_000;
export const MAX_MS = 15_000;

/** Timers behind an interface, so tests drive them with a fake clock. */
export type Timers = { set(fn: () => unknown, ms: number): unknown; clear(id: unknown): void };
export const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as NodeJS.Timeout) };

export type Batch = { chatId: string; eventId: string; items: ChangeItem[]; triggers: IncomingMessage[] };

type Open = Batch & { quiet: unknown; latest: unknown };

export class ListBatcher {
  private open = new Map<string, Open>();

  constructor(
    private opts: {
      timers: Timers;
      /** Posts a batch. Called once per batch. */
      flush: (batch: Batch) => Promise<void>;
      quietMs?: number;
      maxMs?: number;
    },
  ) {}

  /** Adds one change. Returns true when it started a new batch. */
  add(chatId: string, eventId: string, items: ChangeItem[], trigger: IncomingMessage): boolean {
    const key = `${chatId}|${eventId}`;
    const { timers } = this.opts;
    let b = this.open.get(key);
    const fresh = !b;
    if (!b) {
      b = { chatId, eventId, items: [], triggers: [], quiet: null, latest: timers.set(() => this.fire(key), this.opts.maxMs ?? MAX_MS) };
      this.open.set(key, b);
    } else {
      timers.clear(b.quiet);
    }
    b.items.push(...items);
    b.triggers.push(trigger);
    b.quiet = timers.set(() => this.fire(key), this.opts.quietMs ?? QUIET_MS);
    return fresh;
  }

  private fire(key: string) {
    const b = this.open.get(key);
    if (!b) return Promise.resolve();
    this.open.delete(key);
    this.opts.timers.clear(b.quiet);
    this.opts.timers.clear(b.latest);
    const { chatId, eventId, items, triggers } = b;
    return this.opts.flush({ chatId, eventId, items, triggers });
  }
}
