/**
 * Exam seating: every other seat on a checkerboard (rooms seat half their
 * capacity during exams), filled group by group in roll order across the
 * exam's rooms. Pure, so the same plan is shown to students and invigilators.
 */

export type SeatRoom = { id: string; capacity: number };
export type Seat = { group: string; roll: number } | null;
export type RoomPlan = {
  id: string;
  rows: number;
  cols: number;
  /** Row-major; `false` = left empty for spacing, `null` = usable but unfilled. */
  seats: (Seat | false)[];
  usable: number;
};
export type SeatBlock = { group: string; room: string; from: number; to: number };
export type SeatPlan = { rooms: RoomPlan[]; blocks: SeatBlock[]; unseated: number };

export function roomGrid(capacity: number) {
  const cols = Math.min(20, Math.max(4, Math.ceil(Math.sqrt(capacity * 1.5))));
  return { cols, rows: Math.ceil(capacity / cols) };
}

/** Head-count per group, scaled so it never exceeds the exam's size. */
export function headcounts(groups: { id: string; size: number }[], total: number) {
  const sum = groups.reduce((n, g) => n + g.size, 0);
  if (sum <= total || sum === 0) return groups.map((g) => ({ id: g.id, n: g.size }));
  // Largest remainder: floor each share, then hand the leftover seats to the biggest fractions.
  const shares = groups.map((g) => (g.size / sum) * total);
  const out = groups.map((g, i) => ({ id: g.id, n: Math.floor(shares[i] ?? 0) }));
  let left = total - out.reduce((n, g) => n + g.n, 0);
  const order = shares.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((x, y) => y.r - x.r);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]!.n++;
    left--;
  }
  return out;
}

export function seatingPlan(
  rooms: SeatRoom[],
  groups: { id: string; size: number }[],
  total: number,
): SeatPlan {
  const plans: RoomPlan[] = rooms.map((r) => {
    const { cols, rows } = roomGrid(r.capacity);
    const limit = Math.floor(r.capacity / 2);
    let usable = 0;
    const seats: (Seat | false)[] = [];
    for (let i = 0; i < r.capacity; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const ok = (row + col) % 2 === 0 && usable < limit;
      if (ok) usable++;
      seats.push(ok ? null : false);
    }
    return { id: r.id, rows, cols, seats, usable };
  });

  const blocks: SeatBlock[] = [];
  let unseated = 0;
  let room = 0;
  let idx = 0;
  for (const g of headcounts(groups, total)) {
    for (let roll = 1; roll <= g.n; roll++) {
      // Next usable seat, moving to the next room when this one is full.
      let placed = false;
      while (room < plans.length) {
        const p = plans[room]!;
        while (idx < p.seats.length && p.seats[idx] !== null) idx++;
        if (idx < p.seats.length) {
          p.seats[idx] = { group: g.id, roll };
          const last = blocks.at(-1);
          if (last && last.group === g.id && last.room === p.id && last.to === roll - 1) last.to = roll;
          else blocks.push({ group: g.id, room: p.id, from: roll, to: roll });
          placed = true;
          break;
        }
        room++;
        idx = 0;
      }
      if (!placed) unseated++;
    }
  }
  return { rooms: plans, blocks, unseated };
}
