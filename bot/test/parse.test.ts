import { describe, expect, it } from "vitest";
import { parseCommand, triggerBody } from "../src/parse";

describe("triggerBody", () => {
  it("answers !list in any case, with or without words after it", () => {
    expect(triggerBody("!list", false)).toBe("");
    expect(triggerBody("  !LIST thu ", false)).toBe("thu");
    expect(triggerBody("!List: me", false)).toBe("me");
  });

  it("ignores everything else unless the bot is mentioned", () => {
    expect(triggerBody("list thu", false)).toBeNull();
    expect(triggerBody("!listing", false)).toBeNull();
    expect(triggerBody("hey !list thu", false)).toBeNull();
    expect(triggerBody("when is practice?", true)).toBe("when is practice?");
    expect(triggerBody("!list thu", true)).toBe("thu");
  });
});

describe("parseCommand", () => {
  it("reads the overview, help and me", () => {
    expect(parseCommand("")).toEqual({ kind: "overview" });
    expect(parseCommand("help")).toEqual({ kind: "help" });
    expect(parseCommand("ME")).toEqual({ kind: "me" });
  });

  it("treats a bare practice as details", () => {
    for (const p of ["thu", "thursday", "next", "10/23", "oct 23", "tomorrow", "2026-10-23", "next thu"]) {
      expect(parseCommand(p)).toEqual({ kind: "details", practice: p });
    }
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
