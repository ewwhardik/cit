/**
 * The campus as the radar draws it: rooms grouped into building zones, each
 * placed on an isometric grid, plus the per-slot state of every zone.
 *
 * Zones are matched by room type (and building, for the two academic blocks)
 * rather than by room id, so an uploaded dataset with new rooms still lands
 * somewhere sensible.
 */

export type RoomLite = {
  id: string;
  name: string;
  type: string;
  capacity: number;
  building: string;
  features: string[];
};

export type SlotSession = {
  id: string;
  course: string;
  room: string;
  kind: string;
  groups: string[];
  faculty: string;
  size: number;
};

export type SlotEvent = { id: string; title: string; room: string; attendance: number };

export type SlotState = {
  running: SlotSession[];
  events: SlotEvent[];
  free: { id: string; capacity: number; type: string }[];
};

export type ZoneStatus = "empty" | "lecture" | "lab" | "event";

export type Zone = {
  id: string;
  name: string;
  short: string;
  /** Isometric footprint in grid units: x, y = back corner, w along x, d along y, h = height. */
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
};

export const ZONES: Zone[] = [
  { id: "Z-LH", name: "Lecture Hall Complex", short: "LH", x: 0.4, y: 0.4, w: 2.4, d: 1.7, h: 1.6 },
  { id: "Z-ACA", name: "Academic Block A", short: "AC-A", x: 3.6, y: 0.2, w: 2, d: 1.1, h: 1 },
  { id: "Z-ACB", name: "Academic Block B", short: "AC-B", x: 6.2, y: 0.2, w: 2, d: 1.1, h: 1.9 },
  { id: "Z-LIB", name: "Library & Seminar Halls", short: "LIB", x: 0.4, y: 2.9, w: 1.7, d: 1.7, h: 1.4 },
  { id: "Z-AUD", name: "Admin Block & Auditorium", short: "AUD", x: 3.4, y: 2.5, w: 2.2, d: 2, h: 2.3 },
  { id: "Z-OAT", name: "Open Air Theatre", short: "OAT", x: 6.4, y: 2.6, w: 1.9, d: 1.9, h: 0.22 },
  { id: "Z-CSE", name: "CSE Labs", short: "CSE", x: 0.4, y: 5.4, w: 1.5, d: 1.1, h: 1.2 },
  { id: "Z-EE", name: "EE-ECE Labs", short: "EE", x: 2.4, y: 5.4, w: 1.5, d: 1.1, h: 1.2 },
  { id: "Z-PHY", name: "Science Block", short: "PHY", x: 4.4, y: 5.4, w: 1.1, d: 1.1, h: 1 },
  { id: "Z-MECH", name: "Workshop Shed", short: "WS", x: 6, y: 5.2, w: 1.7, d: 1.3, h: 0.8 },
  { id: "Z-CIVIL", name: "Civil Engineering Lab", short: "CIV", x: 8.1, y: 5.4, w: 1, d: 1.1, h: 0.9 },
];

const BY_TYPE: Record<string, string> = {
  lecture_hall: "Z-LH",
  classroom: "Z-ACA",
  seminar_hall: "Z-LIB",
  auditorium: "Z-AUD",
  outdoor: "Z-OAT",
  lab_cs: "Z-CSE",
  lab_elec: "Z-EE",
  lab_phy: "Z-PHY",
  workshop: "Z-MECH",
  lab_civil: "Z-CIVIL",
};

export function zoneOf(room: Pick<RoomLite, "type" | "building">): string {
  if (room.type === "classroom" && /block b/i.test(room.building)) return "Z-ACB";
  return BY_TYPE[room.type] ?? (room.type.startsWith("lab") ? "Z-PHY" : "Z-ACA");
}

/** Rooms per zone, in capacity order. */
export function groupRooms(rooms: RoomLite[]): Map<string, RoomLite[]> {
  const out = new Map<string, RoomLite[]>(ZONES.map((z) => [z.id, []]));
  for (const r of rooms) out.get(zoneOf(r))?.push(r);
  for (const list of out.values()) list.sort((a, b) => b.capacity - a.capacity);
  return out;
}

export type RoomNow =
  | { room: RoomLite; state: "event"; event: SlotEvent; used: number }
  | { room: RoomLite; state: "session"; session: SlotSession; used: number }
  | { room: RoomLite; state: "free" | "idle"; used: 0 };

export type ZoneNow = {
  zone: Zone;
  status: ZoneStatus;
  used: number;
  capacity: number;
  /** Seats in use over seats in the zone, 0–1. */
  ratio: number;
  active: number;
  rooms: RoomNow[];
};

/** What every zone is doing in one slot. Events beat sessions, labs beat lectures for the zone's colour. */
export function zonesAt(slot: SlotState, grouped: Map<string, RoomLite[]>): ZoneNow[] {
  const session = new Map(slot.running.map((s) => [s.room, s]));
  const event = new Map(slot.events.map((e) => [e.room, e]));
  const free = new Set(slot.free.map((f) => f.id));
  return ZONES.map((zone) => {
    const rooms: RoomNow[] = (grouped.get(zone.id) ?? []).map((room) => {
      const e = event.get(room.id);
      if (e) return { room, state: "event", event: e, used: Math.min(e.attendance, room.capacity) };
      const s = session.get(room.id);
      if (s) return { room, state: "session", session: s, used: Math.min(s.size, room.capacity) };
      return { room, state: free.has(room.id) ? "free" : "idle", used: 0 };
    });
    const capacity = rooms.reduce((n, r) => n + r.room.capacity, 0);
    const used = rooms.reduce((n, r) => n + r.used, 0);
    const kinds = rooms.map((r) =>
      r.state === "event" ? "event" : r.state === "session" ? r.session.kind : null,
    );
    const status: ZoneStatus = kinds.includes("event")
      ? "event"
      : kinds.includes("lab")
        ? "lab"
        : kinds.some((k) => k === "lecture" || k === "tutorial")
          ? "lecture"
          : "empty";
    return {
      zone,
      status,
      used,
      capacity,
      ratio: capacity ? used / capacity : 0,
      active: rooms.filter((r) => r.state === "event" || r.state === "session").length,
      rooms,
    };
  });
}

// Isometric projection: one grid unit is TILE px wide on screen, half as tall; LIFT px per unit of height.
const TILE = 64;
const LIFT = 30;

export function iso(x: number, y: number, z = 0): [number, number] {
  return [((x - y) * TILE) / 2, ((x + y) * TILE) / 4 - z * LIFT];
}

export function pts(list: [number, number][]): string {
  return list.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ");
}

/** Screen polygons for a zone's box: top, left (y = y + d) and right (x = x + w) faces. */
export function boxFaces(z: Zone, h = z.h) {
  const { x, y, w, d } = z;
  const top = [iso(x, y, h), iso(x + w, y, h), iso(x + w, y + d, h), iso(x, y + d, h)];
  const left = [iso(x, y + d, h), iso(x + w, y + d, h), iso(x + w, y + d, 0), iso(x, y + d, 0)];
  const right = [iso(x + w, y, h), iso(x + w, y + d, h), iso(x + w, y + d, 0), iso(x + w, y, 0)];
  return { top, left, right };
}

/** Back-to-front draw order so nearer buildings overlap farther ones. */
export const DRAW_ORDER = [...ZONES].sort(
  (a, b) => a.x + a.w / 2 + a.y + a.d / 2 - (b.x + b.w / 2 + b.y + b.d / 2),
);
