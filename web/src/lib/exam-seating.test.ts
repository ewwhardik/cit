import { describe, expect, it } from "vitest";
import { headcounts, type RoomPlan, roomGrid, type Seat, type SeatRoom, seatingPlan } from "./exam-seating";

const filledAt = (plan: RoomPlan) => {
  const out: { row: number; col: number; seat: NonNullable<Seat> }[] = [];
  plan.seats.forEach((seat, i) => {
    if (seat) out.push({ row: Math.floor(i / plan.cols), col: i % plan.cols, seat });
  });
  return out;
};

const sumUsable = (rooms: RoomPlan[]) => rooms.reduce((n, r) => n + r.usable, 0);

const sizes = [1, 2, 3, 4, 5, 7, 10, 20, 30, 45, 60, 100, 150, 200, 300];

describe("roomGrid", () => {
  it("fits the capacity in rows * cols with cols between 4 and 20", () => {
    for (let capacity = 1; capacity <= 300; capacity++) {
      const { rows, cols } = roomGrid(capacity);
      expect(rows * cols).toBeGreaterThanOrEqual(capacity);
      expect(cols).toBeGreaterThanOrEqual(4);
      expect(cols).toBeLessThanOrEqual(20);
    }
  });
});

describe("headcounts", () => {
  it("returns sizes unchanged when their sum fits the total", () => {
    expect(
      headcounts(
        [
          { id: "a", size: 3 },
          { id: "b", size: 4 },
        ],
        10,
      ),
    ).toEqual([
      { id: "a", n: 3 },
      { id: "b", n: 4 },
    ]);
  });

  it("scales sizes so the returned n values sum to exactly the total when over it", () => {
    const groups = [
      { id: "a", size: 30 },
      { id: "b", size: 10 },
      { id: "c", size: 5 },
    ];
    const result = headcounts(groups, 20);
    expect(result.map((g) => g.id)).toEqual(["a", "b", "c"]);
    expect(result.reduce((n, g) => n + g.n, 0)).toBe(20);
    for (const g of result) expect(g.n).toBeGreaterThanOrEqual(0);
  });

  // Known bug: with rounding, non-last groups can take more than is left, the
  // running `left` goes negative, and the final clamp to 0 leaves the sum above
  // total. Expected to fail until exam-seating.ts is fixed.
  it("keeps the n values summing to total when rounding overshoots", () => {
    const groups = ["a", "b", "c", "d", "e"].map((id) => ({ id, size: 1 }));
    const result = headcounts(groups, 3);
    expect(result.reduce((n, g) => n + g.n, 0)).toBe(3);
  });
});

describe("seatingPlan", () => {
  const rooms: SeatRoom[] = [
    { id: "R1", capacity: 20 },
    { id: "R2", capacity: 31 },
  ];
  const groups = [
    { id: "A", size: 25 },
    { id: "B", size: 12 },
  ];
  const total = 37;

  it("sets each room's usable seats to floor(capacity / 2)", () => {
    const plan = seatingPlan(rooms, groups, total);
    expect(plan.rooms.map((r) => r.usable)).toEqual([10, 15]);
    for (const capacity of sizes) {
      const [room] = seatingPlan([{ id: "x", capacity }], [], 0).rooms;
      expect(room?.usable).toBe(Math.floor(capacity / 2));
    }
  });

  it("never seats two students side by side in the same row", () => {
    const plan = seatingPlan([{ id: "R", capacity: 97 }], [{ id: "G", size: 500 }], 500);
    for (const room of plan.rooms) {
      const taken = new Set(filledAt(room).map((s) => `${s.row},${s.col}`));
      for (const { row, col } of filledAt(room)) {
        expect(taken.has(`${row},${col + 1}`)).toBe(false);
      }
    }
  });

  it("seats min(headcount, usable) and reports the rest as unseated", () => {
    const plan = seatingPlan(rooms, groups, total);
    const seated = plan.rooms.reduce((n, r) => n + filledAt(r).length, 0);
    expect(seated).toBe(Math.min(37, sumUsable(plan.rooms)));
    expect(seated).toBe(25);
    expect(plan.unseated).toBe(37 - seated);
    expect(plan.unseated).toBe(12);
  });

  it("seats everyone and reports no unseated when there is room", () => {
    const plan = seatingPlan(
      rooms,
      [
        { id: "A", size: 5 },
        { id: "B", size: 3 },
      ],
      100,
    );
    const seated = plan.rooms.reduce((n, r) => n + filledAt(r).length, 0);
    expect(seated).toBe(8);
    expect(plan.unseated).toBe(0);
  });

  it("seats half of a 20-seat room and leaves the overflow unseated", () => {
    const plan = seatingPlan([{ id: "R", capacity: 20 }], [{ id: "G", size: 15 }], 15);
    expect(plan.rooms[0]?.usable).toBe(10);
    expect(filledAt(plan.rooms[0] as RoomPlan)).toHaveLength(10);
    expect(plan.unseated).toBe(5);
    expect(plan.blocks).toEqual([{ group: "G", room: "R", from: 1, to: 10 }]);
  });

  it("gives each group contiguous roll ranges whose lengths add up to the seated count", () => {
    const plan = seatingPlan(rooms, groups, total);
    const seated = plan.rooms.reduce((n, r) => n + filledAt(r).length, 0);
    expect(plan.blocks.reduce((n, b) => n + (b.to - b.from + 1), 0)).toBe(seated);

    for (const group of groups) {
      const mine = plan.blocks.filter((b) => b.group === group.id);
      // Group B gets no seats here: group A fills all 25 usable seats first.
      if (mine.length > 0) expect(mine[0]?.from).toBe(1);
      for (let i = 1; i < mine.length; i++) {
        expect(mine[i]?.from).toBe((mine[i - 1]?.to ?? 0) + 1);
      }
      const placed = plan.rooms.reduce(
        (n, r) => n + filledAt(r).filter((s) => s.seat.group === group.id).length,
        0,
      );
      expect(mine.reduce((n, b) => n + (b.to - b.from + 1), 0)).toBe(placed);
    }
  });

  it("fills group A from roll 1 and carries it into the second room in order", () => {
    const plan = seatingPlan(
      [
        { id: "R1", capacity: 10 },
        { id: "R2", capacity: 10 },
      ],
      [
        { id: "A", size: 7 },
        { id: "B", size: 3 },
      ],
      10,
    );
    expect(plan.unseated).toBe(0);
    expect(plan.blocks).toEqual([
      { group: "A", room: "R1", from: 1, to: 5 },
      { group: "A", room: "R2", from: 6, to: 7 },
      { group: "B", room: "R2", from: 1, to: 3 },
    ]);
  });
});
