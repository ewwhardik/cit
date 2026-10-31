import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Dataset } from "@/lib/schemas/dataset";
import type { Schedule } from "@/lib/schemas/schedule";
import { periodStartHour } from "@/lib/time";
import { mondayOf, timetableIcs } from "./ics";

const ds = JSON.parse(
  readFileSync(new URL("../../../starter/data/cit_public.json", import.meta.url), "utf-8"),
) as Dataset;
const schedule = JSON.parse(
  readFileSync(new URL("../../../exports/schedule.json", import.meta.url), "utf-8"),
) as Schedule;

const WEEK_OF = "2027-02-08";
const STAMP = new Date("2027-01-01T00:00:00Z");
const gen = (view: "group" | "faculty" | "room", id: string, label = "x") =>
  timetableIcs(ds, schedule, view, id, { weekOf: WEEK_OF, label, stamp: STAMP });

const sessionsById = new Map(ds.sessions.map((s) => [s.id, s]));

/** Splits an ICS string into the property lines of each VEVENT. */
const eventBlocks = (ics: string): string[][] => {
  const out: string[][] = [];
  let cur: string[] | null = null;
  for (const line of ics.split("\r\n")) {
    if (line === "BEGIN:VEVENT") cur = [];
    else if (line === "END:VEVENT") {
      if (cur) out.push(cur);
      cur = null;
    } else if (cur) cur.push(line);
  }
  return out;
};

/** Value of the first property whose name is `name` (with or without params). */
const field = (block: string[], name: string): string | undefined =>
  block.find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));

describe("mondayOf", () => {
  it("returns the same day for a Monday and the preceding Monday for a Thursday", () => {
    expect(mondayOf("2027-02-08").toISOString().slice(0, 10)).toBe("2027-02-08");
    expect(mondayOf("2027-02-11").toISOString().slice(0, 10)).toBe("2027-02-08");
  });
});

describe("timetableIcs", () => {
  it("wraps the events in a well-formed CRLF calendar", () => {
    const ics = gen("group", "Y1-A");
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("emits one VEVENT per placed session the group attends", () => {
    const expected = schedule.sessions.filter((p) => sessionsById.get(p.session_id)?.groups.includes("Y1-A"));
    expect(expected.length).toBeGreaterThan(0);
    const ics = gen("group", "Y1-A");
    expect(ics.split("BEGIN:VEVENT").length - 1).toBe(expected.length);
    expect(eventBlocks(ics)).toHaveLength(expected.length);
  });

  it("puts every event in Asia/Kolkata on Mon-Fri of the requested week and repeats it 16 weeks", () => {
    const events = eventBlocks(gen("group", "Y1-A"));
    const dtstart = /^DTSTART;TZID=Asia\/Kolkata:(\d{8})T\d{2}0000$/;
    const badStarts = events
      .map((b) => field(b, "DTSTART") ?? "<missing>")
      .filter((l) => {
        const m = dtstart.exec(l);
        const date = m?.[1];
        return !date || date < "20270208" || date > "20270212";
      });
    expect(badStarts).toEqual([]);

    const badRrules = events
      .map((b) => field(b, "RRULE") ?? "<missing>")
      .filter((r) => r !== "RRULE:FREQ=WEEKLY;COUNT=16");
    expect(badRrules).toEqual([]);
  });

  it("gives a 3-period lab a 3-hour DTEND-DTSTART span at its scheduled start", () => {
    const lab = ds.sessions.find(
      (s) =>
        s.groups.includes("Y1-A") &&
        s.kind === "lab" &&
        s.duration === 3 &&
        schedule.sessions.some((p) => p.session_id === s.id),
    );
    expect(lab, "a placed Y1-A 3-period lab exists in the dataset").toBeDefined();
    const labId = lab!.id;
    const placement = schedule.sessions.find((p) => p.session_id === labId)!;

    const block = eventBlocks(gen("group", "Y1-A")).find((b) =>
      b.includes(`UID:${labId}-group-Y1-A@cit-scheduler`),
    );
    expect(block, `VEVENT for ${labId}`).toBeDefined();

    const hourOf = (l: string | undefined) => {
      const m = /T(\d{2})0000$/.exec(l ?? "");
      return m ? Number(m[1]) : NaN;
    };
    const startH = hourOf(field(block!, "DTSTART"));
    const endH = hourOf(field(block!, "DTEND"));
    expect(startH).toBe(periodStartHour(placement.start_period));
    expect(endH - startH).toBe(3);
  });

  it("produces a valid calendar with zero events for a room with no sessions", () => {
    const used = new Set(schedule.sessions.map((p) => p.room_id));
    const unused = ds.rooms.map((r) => r.id).find((id) => !used.has(id));
    expect(unused, "a dataset room with no placements exists").toBeDefined();

    const ics = gen("room", unused!);
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("BEGIN:VEVENT").length - 1).toBe(0);
  });

  it("escapes commas and semicolons in the calendar name", () => {
    const ics = gen("group", "Y1-A", "a,b;c");
    expect(ics).toContain("X-WR-CALNAME:a\\,b\\;c\r\n");
  });
});
