/**
 * How a room is furnished in the 3D walkthrough, derived only from its type
 * and capacity so any uploaded dataset gets sensible interiors.
 */

export type Furnishing = "desks" | "computers" | "benches" | "workshop" | "arena";

export type RoomLayout = {
  furnishing: Furnishing;
  cols: number;
  rows: number;
  /** Seat pitch across a row and between rows, metres. */
  pitchX: number;
  pitchZ: number;
  /** Rise per row for tiered halls, metres (0 = flat floor). */
  rise: number;
  /** Inner size of the room, metres. */
  width: number;
  depth: number;
  height: number;
  /** Space kept clear at the front (board, stage) and back, metres. */
  front: number;
  back: number;
};

const FURNISH: Record<string, Furnishing> = {
  lab_cs: "computers",
  lab_elec: "benches",
  lab_phy: "benches",
  lab_civil: "benches",
  workshop: "workshop",
  outdoor: "arena",
};

export function furnishingOf(type: string): Furnishing {
  return FURNISH[type] ?? (type.startsWith("lab") ? "benches" : "desks");
}

export function roomLayout(type: string, capacity: number): RoomLayout {
  const furnishing = furnishingOf(type);
  const seats = Math.max(1, Math.round(capacity));
  const tiered = type === "lecture_hall" || type === "auditorium" || furnishing === "arena";
  const pitchX = furnishing === "computers" ? 1.2 : furnishing === "desks" ? 0.85 : 1.4;
  const pitchZ = furnishing === "desks" ? (tiered ? 1.0 : 1.15) : 1.9;
  // Rooms are a little wider than deep, like real lecture rooms.
  const cols = Math.min(furnishing === "arena" ? 40 : 26, Math.max(4, Math.ceil(Math.sqrt(seats * 1.7))));
  const rows = Math.ceil(seats / cols);
  const front = furnishing === "arena" ? 9 : tiered ? 5 : 3.5;
  const back = 2;
  return {
    furnishing,
    cols,
    rows,
    pitchX,
    pitchZ,
    rise: tiered ? (furnishing === "arena" ? 0.45 : 0.28) : 0,
    width: cols * pitchX + 4,
    depth: front + rows * pitchZ + back,
    height: type === "auditorium" ? 9 : tiered ? 6 : 3.4,
    front,
    back,
  };
}

/**
 * Seat positions (x across, z from the front wall, y floor height), row by row
 * from the front. The first `used` seats are the occupied ones, filled from the
 * front-centre outwards like a real class.
 */
export function seatPositions(l: RoomLayout, capacity: number) {
  const out: { x: number; y: number; z: number; row: number; order: number }[] = [];
  for (let r = 0; r < l.rows; r++)
    for (let c = 0; c < l.cols; c++) {
      if (out.length >= capacity) break;
      const x = (c - (l.cols - 1) / 2) * l.pitchX;
      out.push({ x, y: r * l.rise, z: l.front + r * l.pitchZ + l.pitchZ / 2, row: r, order: 0 });
    }
  // Front rows first, centre seats before aisles.
  const ranked = [...out].sort((a, b) => a.row - b.row || Math.abs(a.x) - Math.abs(b.x));
  ranked.forEach((s, i) => {
    s.order = i;
  });
  return out;
}
