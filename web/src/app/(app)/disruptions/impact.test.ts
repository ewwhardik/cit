import { describe, expect, it } from "vitest";
import { impactOf, type Placed } from "./impact";

const cls = (over: Partial<Placed> & Pick<Placed, "id">): Placed => ({
  course: "Course",
  faculty: "F1",
  groups: ["G1"],
  room: "R1",
  day: "Mon",
  start: 1,
  dur: 1,
  ...over,
});

describe("impactOf", () => {
  it("hits only the faculty's sessions that overlap the given days and periods", () => {
    const lab = cls({ id: "lab", faculty: "F1", day: "Mon", start: 2, dur: 3 });
    const placed = [
      lab,
      cls({ id: "other-faculty", faculty: "F2", day: "Mon", start: 2, dur: 3 }),
      cls({ id: "other-day", faculty: "F1", day: "Tue", start: 2, dur: 3 }),
    ];

    const p4 = impactOf(
      [{ type: "faculty_unavailable", faculty_id: "F1", days: ["Mon"], periods: [4] }],
      placed,
    );
    expect(p4.hit.map((h) => h.p.id)).toEqual(["lab"]);
    expect(p4.hit[0]?.why).toBe("F1 on leave");

    const p5 = impactOf(
      [{ type: "faculty_unavailable", faculty_id: "F1", days: ["Mon"], periods: [5] }],
      placed,
    );
    expect(p5.hit).toEqual([]);
  });

  it("hits only sessions in the unavailable room that overlap the given days and periods", () => {
    const inRoom = cls({ id: "in-room", room: "R1", day: "Mon", start: 2, dur: 3 });
    const placed = [inRoom, cls({ id: "elsewhere", room: "R2", day: "Mon", start: 2, dur: 3 })];

    const result = impactOf(
      [{ type: "room_unavailable", room_id: "R1", days: ["Mon"], periods: [4] }],
      placed,
    );
    expect(result.hit.map((h) => h.p.id)).toEqual(["in-room"]);
    expect(result.hit[0]?.why).toBe("R1 closed");

    const miss = impactOf([{ type: "room_unavailable", room_id: "R1", days: ["Tue"], periods: [2] }], placed);
    expect(miss.hit).toEqual([]);
  });

  it("closes every day|period of both faculty and room changes", () => {
    const result = impactOf(
      [
        { type: "faculty_unavailable", faculty_id: "F1", days: ["Mon", "Tue"], periods: [1, 2] },
        { type: "room_unavailable", room_id: "R1", days: ["Wed"], periods: [9] },
      ],
      [],
    );
    expect([...result.closed].sort()).toEqual(["Mon|1", "Mon|2", "Tue|1", "Tue|2", "Wed|9"]);
  });

  it("hits only the removed session", () => {
    const placed = [cls({ id: "keep" }), cls({ id: "drop", start: 3 })];

    const result = impactOf([{ type: "remove_session", session_id: "drop" }], placed);
    expect(result.hit.map((h) => h.p.id)).toEqual(["drop"]);
    expect(result.hit[0]?.why).toBe("removed");
    expect(result.closed.size).toBe(0);
  });

  it("counts added sessions without hitting any placed class", () => {
    const placed = [cls({ id: "a" })];

    const result = impactOf(
      [
        { type: "add_session", session: { id: "new-1" } },
        { type: "add_session", session: { id: "new-2" } },
      ],
      placed,
    );
    expect(result.added).toBe(2);
    expect(result.hit).toEqual([]);
    expect(result.closed.size).toBe(0);
  });

  it("lists a session hit by two changes only once", () => {
    const placed = [cls({ id: "double", faculty: "F1", room: "R1", day: "Mon", start: 2, dur: 3 })];

    const result = impactOf(
      [
        { type: "faculty_unavailable", faculty_id: "F1", days: ["Mon"], periods: [4] },
        { type: "room_unavailable", room_id: "R1", days: ["Mon"], periods: [2] },
        { type: "remove_session", session_id: "double" },
      ],
      placed,
    );
    expect(result.hit.map((h) => h.p.id)).toEqual(["double"]);
  });

  it("ignores unknown change types", () => {
    const placed = [cls({ id: "a" })];

    const result = impactOf([{ type: "teleport_session" }], placed);
    expect(result.hit).toEqual([]);
    expect(result.closed.size).toBe(0);
    expect(result.added).toBe(0);
  });
});
