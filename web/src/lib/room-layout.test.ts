import { describe, expect, it } from "vitest";
import { furnishingOf, roomLayout, seatPositions } from "./room-layout";

describe("furnishingOf", () => {
  it("furnishes CS labs with computers", () => {
    expect(furnishingOf("lab_cs")).toBe("computers");
  });
  it("furnishes workshops as workshops", () => {
    expect(furnishingOf("workshop")).toBe("workshop");
  });
  it("furnishes outdoor spaces as an arena", () => {
    expect(furnishingOf("outdoor")).toBe("arena");
  });
  it("falls back to benches for unknown lab types", () => {
    expect(furnishingOf("lab_xyz")).toBe("benches");
  });
  it("furnishes classrooms with desks", () => {
    expect(furnishingOf("classroom")).toBe("desks");
  });
});

describe("roomLayout", () => {
  it.each([1, 40, 180, 500, 800])("has room for %i seats", (capacity) => {
    const l = roomLayout("classroom", capacity);
    expect(l.rows * l.cols).toBeGreaterThanOrEqual(capacity);
  });

  it.each(["lecture_hall", "auditorium"])("gives %s a positive rise", (type) => {
    expect(roomLayout(type, 200).rise).toBeGreaterThan(0);
  });

  it("keeps a classroom flat", () => {
    expect(roomLayout("classroom", 60).rise).toBe(0);
  });

  it("makes auditoriums 9 m high", () => {
    expect(roomLayout("auditorium", 300).height).toBe(9);
  });

  it.each([
    ["classroom", 1],
    ["classroom", 800],
    ["lecture_hall", 180],
    ["auditorium", 500],
    ["outdoor", 40],
  ])("gives positive width and depth for %s with %i seats", (type, capacity) => {
    const l = roomLayout(type, capacity);
    expect(l.width).toBeGreaterThan(0);
    expect(l.depth).toBeGreaterThan(0);
  });
});

describe("seatPositions", () => {
  it.each([1, 40, 180, 500, 800])("returns exactly %i seats", (capacity) => {
    const l = roomLayout("classroom", capacity);
    expect(seatPositions(l, capacity)).toHaveLength(capacity);
  });

  it("numbers seats 0..n-1 exactly once, front rows first", () => {
    const capacity = 180;
    const seats = seatPositions(roomLayout("lecture_hall", capacity), capacity);
    const orders = seats.map((s) => s.order).sort((a, b) => a - b);
    expect(orders).toEqual(Array.from({ length: capacity }, (_, i) => i));
  });

  it("starts at the centre of the front row", () => {
    const capacity = 40;
    const seats = seatPositions(roomLayout("classroom", capacity), capacity);
    const first = seats.find((s) => s.order === 0);
    expect(first).toBeDefined();
    expect(first?.row).toBe(0);
    const frontRow = seats.filter((s) => s.row === 0);
    const minAbsX = Math.min(...frontRow.map((s) => Math.abs(s.x)));
    expect(Math.abs(first?.x ?? Number.NaN)).toBeCloseTo(minAbsX);
  });

  it("increases z with row", () => {
    const capacity = 180;
    const seats = seatPositions(roomLayout("lecture_hall", capacity), capacity);
    const zByRow = new Map<number, number>();
    for (const s of seats) zByRow.set(s.row, s.z);
    const rows = [...zByRow.keys()].sort((a, b) => a - b);
    for (let i = 1; i < rows.length; i++) {
      const prev = zByRow.get(rows[i - 1] ?? -1) ?? Number.NaN;
      const curr = zByRow.get(rows[i] ?? -1) ?? Number.NaN;
      expect(curr).toBeGreaterThan(prev);
    }
  });
});
