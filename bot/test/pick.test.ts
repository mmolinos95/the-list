import { describe, expect, it } from "vitest";
import { matchLists, parseSelector, pickPractice, splitSelector } from "../src/pick";
import { fakePractice } from "./fixtures";

// Thu Oct 22 2026, 9 PM New York (EDT) is already Friday in UTC.
const thuNight = fakePractice("2026-10-23T01:00:00Z");
// Sat Oct 24, 10 AM New York.
const sat = fakePractice("2026-10-24T14:00:00Z");
// Sun Nov 1 2026, 10 AM New York: the day daylight saving ends (EST, UTC-5).
const dstSunday = fakePractice("2026-11-01T15:00:00Z");
// Thu Oct 29, 7 PM New York.
const nextThu = fakePractice("2026-10-29T23:00:00Z");
const all = [thuNight, sat, nextThu, dstSunday];

describe("parseSelector", () => {
  it("accepts loose practice names", () => {
    for (const s of ["thu", "Thursday", "thurs", "next thu", "this sat", "next", "today", "tonight", "tomorrow", "10/23", "10/23/26", "oct 23", "October 23rd", "23 oct", "2026-10-23", "2026-10-23-fri"]) {
      expect(parseSelector(s), s).not.toBeNull();
    }
  });

  it("rejects everything else", () => {
    for (const s of ["", "games", "13/40", "me", "in", "ja 3", "who is coming"]) expect(parseSelector(s), s).toBeNull();
  });

  it("splits the selector off the front, preferring two words", () => {
    expect(splitSelector("oct 23 games")).toEqual({ selector: "oct 23", rest: "games" });
    expect(splitSelector("thu skills games")).toEqual({ selector: "thu", rest: "skills games" });
    expect(splitSelector("games thu")).toBeNull();
  });
});

describe("pickPractice", () => {
  const wedNoon = new Date("2026-10-21T16:00:00Z");

  it("uses New York weekdays and dates, not UTC", () => {
    expect(pickPractice("thu", all, wedNoon)).toBe(thuNight);
    expect(pickPractice("thursday", all, wedNoon)).toBe(thuNight);
    expect(pickPractice("10/22", all, wedNoon)).toBe(thuNight);
    expect(pickPractice("fri", all, wedNoon)).toBeNull();
    expect(pickPractice("2026-10-22", all, wedNoon)).toBe(thuNight);
  });

  it("knows 'today' late in the New York evening is still the same day", () => {
    const thu10pm = new Date("2026-10-23T02:00:00Z"); // Thu 10 PM New York, Fri in UTC
    expect(pickPractice("today", all, thu10pm)).toBe(thuNight);
    expect(pickPractice("tomorrow", all, thu10pm)).toBeNull();
    expect(pickPractice("sat", all, thu10pm)).toBe(sat);
  });

  it("skips practices that are over, so 'thu' moves to next week", () => {
    const friMorning = new Date("2026-10-23T13:00:00Z");
    expect(pickPractice("thu", all, friMorning)).toBe(nextThu);
    expect(pickPractice("next", all, friMorning)).toBe(sat);
  });

  it("handles the day daylight saving ends", () => {
    expect(pickPractice("sun", all, wedNoon)).toBe(dstSunday);
    expect(pickPractice("11/1", all, wedNoon)).toBe(dstSunday);
    expect(pickPractice("nov 1", all, wedNoon)).toBe(dstSunday);
  });

  it("'next' skips cancelled practices; a weekday still finds them", () => {
    const cancelled = fakePractice("2026-10-22T23:00:00Z", { cancelled: "2026-10-21T10:00:00Z" });
    const list = [cancelled, sat];
    expect(pickPractice("next", list, wedNoon)).toBe(sat);
    expect(pickPractice("thu", list, wedNoon)).toBe(cancelled);
  });

  it("finds a practice by its slug", () => {
    const p = fakePractice("2026-10-24T14:00:00Z", { slug: "2026-10-24-sat" });
    expect(pickPractice("2026-10-24-sat", [p], wedNoon)).toBe(p);
  });
});

describe("matchLists", () => {
  const p = fakePractice("2026-10-24T14:00:00Z", { lists: [{ name: "Skills" }, { name: "Games" }] });
  const names = (r: ReturnType<typeof matchLists>) => r.lists.map((l) => l.name);

  it("matches list names in any case, and both/all", () => {
    expect(names(matchLists("games", p.lists))).toEqual(["Games"]);
    expect(names(matchLists("Skills and GAMES", p.lists))).toEqual(["Skills", "Games"]);
    expect(names(matchLists("both", p.lists))).toEqual(["Skills", "Games"]);
    expect(matchLists("", p.lists)).toEqual({ lists: [], unknown: null });
  });

  it("reports words that aren't a list", () => {
    expect(matchLists("goalie", p.lists)).toEqual({ lists: [], unknown: "goalie" });
  });
});
