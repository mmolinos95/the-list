import { describe, expect, it } from "vitest";
import { KeyedQueue, Pacer } from "../src/chat";

function clock() {
  let t = 0;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    slept,
    advance: (ms: number) => (t += ms),
  };
}

describe("Pacer", () => {
  it("keeps a minimum gap between the bot's messages", async () => {
    const c = clock();
    const p = new Pacer({ minGapMs: 2000, perMinute: 100, now: c.now, sleep: c.sleep });
    const times: number[] = [];
    await Promise.all([1, 2, 3].map(() => p.run(async () => void times.push(c.now()))));
    expect(times).toEqual([0, 2000, 4000]);
  });

  it("caps messages per minute, making the rest wait", async () => {
    const c = clock();
    const p = new Pacer({ minGapMs: 0, perMinute: 3, now: c.now, sleep: c.sleep });
    const times: number[] = [];
    await Promise.all([1, 2, 3, 4, 5].map(() => p.run(async () => void times.push(c.now()))));
    expect(times).toEqual([0, 0, 0, 60_000, 60_000]);
  });

  it("keeps going after a failed send", async () => {
    const c = clock();
    const p = new Pacer({ minGapMs: 1000, perMinute: 10, now: c.now, sleep: c.sleep });
    await expect(p.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(p.run(async () => "ok")).resolves.toBe("ok");
  });
});

describe("KeyedQueue", () => {
  it("runs one task at a time per key, in order", async () => {
    const q = new KeyedQueue();
    const log: string[] = [];
    const task = (name: string, ms: number) => async () => {
      log.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`end ${name}`);
    };
    await Promise.all([q.push("a", task("a1", 20)), q.push("a", task("a2", 1)), q.push("b", task("b1", 1))]);
    expect(log.indexOf("end a1")).toBeLessThan(log.indexOf("start a2"));
    expect(log.indexOf("start b1")).toBeLessThan(log.indexOf("end a1"));
  });

  it("isn't blocked by a failing task", async () => {
    const q = new KeyedQueue();
    let ran = false;
    await q.push("a", async () => {
      throw new Error("x");
    });
    await q.push("a", async () => void (ran = true));
    expect(ran).toBe(true);
  });
});
