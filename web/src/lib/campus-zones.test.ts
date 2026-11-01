import { describe, expect, it } from "vitest";
import {
  boxFaces,
  groupRooms,
  iso,
  type RoomLite,
  type SlotState,
  ZONES,
  zoneOf,
  zonesAt,
} from "./campus-zones";

const room = (over: Partial<RoomLite> & Pick<RoomLite, "id" | "type" | "capacity">): RoomLite => ({
  name: over.id,
  building: "Main Campus",
  features: [],
  ...over,
});

describe("zoneOf", () => {
  it("puts Block B classrooms in Z-ACB by building name", () => {
    expect(zoneOf({ type: "classroom", building: "Academic Block B (2nd floor, no lift)" })).toBe("Z-ACB");
  });
  it("puts other classrooms in Z-ACA", () => {
    expect(zoneOf({ type: "classroom", building: "Academic Block A (ground floor)" })).toBe("Z-ACA");
  });
  it("maps known room types to their zones", () => {
    expect(zoneOf({ type: "lecture_hall", building: "" })).toBe("Z-LH");
    expect(zoneOf({ type: "outdoor", building: "" })).toBe("Z-OAT");
    expect(zoneOf({ type: "lab_cs", building: "" })).toBe("Z-CSE");
  });
  it("falls back to Z-PHY for unknown lab types", () => {
    expect(zoneOf({ type: "lab_bio", building: "" })).toBe("Z-PHY");
  });
  it("falls back to Z-ACA for unknown non-lab types", () => {
    expect(zoneOf({ type: "studio", building: "" })).toBe("Z-ACA");
  });
});

describe("groupRooms", () => {
  it("has a key for every zone, even when empty", () => {
    const grouped = groupRooms([]);
    expect([...grouped.keys()].sort()).toEqual(ZONES.map((z) => z.id).sort());
    for (const list of grouped.values()) expect(list).toEqual([]);
  });
  it("sorts rooms inside a zone by capacity, descending", () => {
    const rooms = [
      room({ id: "small", type: "classroom", capacity: 30, building: "Academic Block A" }),
      room({ id: "big", type: "classroom", capacity: 120, building: "Academic Block A" }),
      room({ id: "mid", type: "classroom", capacity: 60, building: "Academic Block A" }),
    ];
    const ids = groupRooms(rooms)
      .get("Z-ACA")
      ?.map((r) => r.id);
    expect(ids).toEqual(["big", "mid", "small"]);
  });
});

describe("zonesAt", () => {
  const rooms: RoomLite[] = [
    room({ id: "LH-1", type: "lecture_hall", capacity: 200, building: "Lecture Complex" }),
    room({ id: "CS-LAB-1", type: "lab_cs", capacity: 90, building: "CSE Dept" }),
    room({ id: "AUD", type: "auditorium", capacity: 500, building: "Admin" }),
    room({ id: "CR-101", type: "classroom", capacity: 90, building: "Academic Block A" }),
  ];
  const grouped = groupRooms(rooms);
  const slot: SlotState = {
    running: [
      { id: "s-lec", course: "Maths", room: "LH-1", kind: "lecture", groups: [], faculty: "F1", size: 150 },
      { id: "s-lab", course: "OS Lab", room: "CS-LAB-1", kind: "lab", groups: [], faculty: "F2", size: 120 },
    ],
    events: [{ id: "e1", title: "Fest", room: "AUD", attendance: 450 }],
    free: [{ id: "CR-101", capacity: 90, type: "classroom" }],
  };
  const byZone = new Map(zonesAt(slot, grouped).map((z) => [z.zone.id, z]));

  it("reports a lecture zone with its seats used and ratio", () => {
    const lh = byZone.get("Z-LH");
    expect(lh?.status).toBe("lecture");
    expect(lh?.used).toBe(150);
    expect(lh?.capacity).toBe(200);
    expect(lh?.ratio).toBeCloseTo(0.75);
  });

  it("caps a lab's used seats at the room capacity", () => {
    const cse = byZone.get("Z-CSE");
    expect(cse?.status).toBe("lab");
    expect(cse?.used).toBe(90);
  });

  it("reports an event zone with its attendance", () => {
    const aud = byZone.get("Z-AUD");
    expect(aud?.status).toBe("event");
    expect(aud?.used).toBe(450);
  });

  it("reports an unused zone as empty with a free room", () => {
    const aca = byZone.get("Z-ACA");
    expect(aca?.status).toBe("empty");
    expect(aca?.rooms).toHaveLength(1);
    expect(aca?.rooms[0]?.state).toBe("free");
    expect(aca?.active).toBe(0);
  });

  it("marks a room as an event when it has both an event and a session in the slot", () => {
    const both: SlotState = {
      running: [{ id: "s", course: "C", room: "LH-1", kind: "lecture", groups: [], faculty: "", size: 50 }],
      events: [{ id: "e", title: "Talk", room: "LH-1", attendance: 80 }],
      free: [],
    };
    const lh = zonesAt(both, grouped).find((z) => z.zone.id === "Z-LH");
    expect(lh?.rooms[0]?.state).toBe("event");
    expect(lh?.status).toBe("event");
    expect(lh?.used).toBe(80);
  });
});

describe("boxFaces and iso", () => {
  it("returns three faces of four points each", () => {
    const zone = ZONES[0];
    if (!zone) throw new Error("ZONES is empty");
    const faces = boxFaces(zone);
    expect(Object.keys(faces).sort()).toEqual(["left", "right", "top"]);
    for (const face of Object.values(faces)) {
      expect(face).toHaveLength(4);
      for (const point of face) expect(point).toHaveLength(2);
    }
  });
  it("projects the origin to [0, 0]", () => {
    expect(iso(0, 0, 0)).toEqual([0, 0]);
  });
});
