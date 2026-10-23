import { describe, expect, it } from "vitest";
import { parseCommand, triggerBody } from "../src/parse";

describe("triggerBody", () => {
  it("answers ! plus a command word, in any case", () => {
    expect(triggerBody("!list", false)).toBe("list");
    expect(triggerBody("  !LIST thu ", false)).toBe("LIST thu");
    expect(triggerBody("!in mon", false)).toBe("in mon");
    expect(triggerBody("! out fri", false)).toBe("out fri");
    expect(triggerBody("!Me", false)).toBe("Me");
    expect(triggerBody("!week", false)).toBe("week");
    expect(triggerBody("!sign up thu", false)).toBe("sign up thu");
  });

  it("ignores ! messages that aren't commands, and everything else unless the bot is mentioned", () => {
    for (const t of ["!!!", "!nice", "!listing", "! ", "!", "list thu", "hey !in thu", "in thu"]) expect(triggerBody(t, false)).toBeNull();
    expect(triggerBody("when is practice?", true)).toBe("when is practice?");
    expect(triggerBody("!nice one", true)).toBe("nice one");
    expect(triggerBody("!in thu", true)).toBe("in thu");
  });
});

describe("parseCommand", () => {
  it("reads week, help and me", () => {
    expect(parseCommand("")).toEqual({ kind: "week" });
    expect(parseCommand("week")).toEqual({ kind: "week" });
    expect(parseCommand("help")).toEqual({ kind: "help" });
    expect(parseCommand("ME")).toEqual({ kind: "me" });
  });

  it("reads list, with or without a practice, and a bare practice as its list", () => {
    expect(parseCommand("list")).toEqual({ kind: "list", practice: "" });
    expect(parseCommand("LIST thu")).toEqual({ kind: "list", practice: "thu" });
    for (const p of ["thu", "thursday", "next", "10/23", "oct 23", "tomorrow", "2026-10-23", "next thu"]) {
      expect(parseCommand(p)).toEqual({ kind: "list", practice: p });
    }
  });

  it("still understands the old !list in / !list me form", () => {
    expect(parseCommand("list in thu")).toEqual({ kind: "in", practice: "thu", lists: "" });
    expect(parseCommand("list me")).toEqual({ kind: "me" });
    expect(parseCommand("list out fri yes")).toEqual({ kind: "out", practice: "fri", lists: "", confirm: true });
  });

  it("splits commands into practice and the rest", () => {
    expect(parseCommand("in thu")).toEqual({ kind: "in", practice: "thu", lists: "" });
    expect(parseCommand("in thu skills")).toEqual({ kind: "in", practice: "thu", lists: "skills" });
    expect(parseCommand("sign up oct 23 games")).toEqual({ kind: "in", practice: "oct 23", lists: "games" });
    expect(parseCommand("out fri games")).toEqual({ kind: "out", practice: "fri", lists: "games", confirm: false });
    expect(parseCommand("out fri yes")).toEqual({ kind: "out", practice: "fri", lists: "", confirm: true });
    expect(parseCommand("cancel thu field is flooded")).toEqual({ kind: "cancel", practice: "thu", reason: "field is flooded", confirm: false });
    expect(parseCommand("cancel thu yes")).toEqual({ kind: "cancel", practice: "thu", reason: "", confirm: true });
    expect(parseCommand("add thu Jane Doe games waitlist")).toEqual({ kind: "add", practice: "thu", rest: "Jane Doe games waitlist" });
    expect(parseCommand("post 10/23")).toEqual({ kind: "post", practice: "10/23" });
    expect(parseCommand("teams thu")).toEqual({ kind: "teams", practice: "thu" });
    expect(parseCommand("open thu")).toEqual({ kind: "open", practice: "thu" });
  });

  it("keeps a command with no practice, so the bot can ask which", () => {
    expect(parseCommand("in")).toEqual({ kind: "in", practice: "", lists: "" });
  });

  it("falls back to free text when it isn't a command", () => {
    expect(parseCommand("when is the next practice?")).toEqual({ kind: "free", text: "when is the next practice?" });
    expect(parseCommand("out of curiosity, who's coming")).toEqual({ kind: "free", text: "out of curiosity, who's coming" });
    expect(parseCommand("me and my friend want in")).toEqual({ kind: "free", text: "me and my friend want in" });
    expect(parseCommand("post something cool")).toEqual({ kind: "free", text: "post something cool" });
    // There is no lock command: the list locks on its own.
    expect(parseCommand("lock thu")).toEqual({ kind: "free", text: "lock thu" });
  });
});
