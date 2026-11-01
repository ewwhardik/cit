/**
 * Procedural three.js builders for the 3D campus: the outdoor campus (one
 * building per zone, one storey per room) and walk-in room interiors. No model
 * files: every texture is drawn on a small canvas, repeated things (trees,
 * lamps, seats, people) are instanced, and only floors that change status get
 * a material update.
 */
import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { type RoomLite, ZONES, type Zone } from "@/lib/campus-zones";
import { roomLayout, seatPositions } from "@/lib/room-layout";

/** Metres per campus grid unit. */
export const S = 15;
export const STOREY = 4;
const CX = 4.75 * S;
const CZ = 3.45 * S;

export type FloorLook = "lecture" | "lab" | "event" | "free" | "match" | "dim";

const LOOK: Record<FloorLook, { color: string; intensity: number }> = {
  lecture: { color: "#ffc978", intensity: 2 },
  lab: { color: "#ff8a45", intensity: 2.8 },
  event: { color: "#ff4fd8", intensity: 3 },
  free: { color: "#9fd4ff", intensity: 0.18 },
  match: { color: "#4dff95", intensity: 3.2 },
  dim: { color: "#000000", intensity: 0 },
};

/** Deterministic PRNG so trees land in the same place on every visit. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (g) draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Glass curtain wall: dark panes and mullions (map) and the pane mask that glows (emissive). */
function windowTextures() {
  const draw = (glow: boolean) => (g: CanvasRenderingContext2D) => {
    g.fillStyle = glow ? "#000" : "#c9c1b2";
    g.fillRect(0, 0, 128, 64);
    for (let i = 0; i < 4; i++) {
      const x = 4 + i * 31;
      if (glow) {
        g.fillStyle = "#fff";
      } else {
        const grd = g.createLinearGradient(0, 6, 0, 58);
        grd.addColorStop(0, "#5d7686");
        grd.addColorStop(0.5, "#2b3c48");
        grd.addColorStop(1, "#1c2730");
        g.fillStyle = grd;
      }
      g.fillRect(x, 6, 27, 52);
    }
  };
  const map = canvasTexture(128, 64, draw(false));
  const glow = canvasTexture(128, 64, draw(true));
  for (const t of [map, glow]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { map, glow };
}

function noiseTexture(base: string, spread: number, seed: number, size = 256) {
  const r = rng(seed);
  const t = canvasTexture(size, size, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < size * 14; i++) {
      const v = (r() - 0.5) * spread;
      g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
      g.fillRect(r() * size, r() * size, 2, 2);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export type Floor = { roomId: string; zoneId: string; mat: THREE.MeshStandardMaterial; mesh: THREE.Mesh };

export type ZoneBuild = {
  zone: Zone;
  /** Roof centre, for labels and fly-to. */
  top: THREE.Vector3;
  /** Spot in front of the entrance, facing the building. */
  door: THREE.Vector3;
  /** XZ footprint used for walking collisions. */
  box: { x0: number; x1: number; z0: number; z1: number };
};

export type Campus = {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  sky: Sky;
  hemi: THREE.HemisphereLight;
  lamps: THREE.MeshStandardMaterial;
  floors: Map<string, Floor>;
  zones: Map<string, ZoneBuild>;
  pickables: THREE.Object3D[];
  dispose: () => void;
};

function zoneRect(z: Zone) {
  const w = z.w * S * 0.84;
  const d = z.d * S * 0.84;
  const cx = (z.x + z.w / 2) * S - CX;
  const cz = (z.y + z.d / 2) * S - CZ;
  return { w, d, cx, cz };
}

export function buildCampus(grouped: Map<string, RoomLite[]>): Campus {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#cfd9de", 160, 520);
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => {
    disposables.push(x);
    return x;
  };

  // Sky + lights.
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const u = sky.material.uniforms;
  u.turbidity!.value = 5;
  u.rayleigh!.value = 1.4;
  u.mieCoefficient!.value = 0.004;
  u.mieDirectionalG!.value = 0.8;
  scene.add(sky);
  keep(sky.geometry);
  keep(sky.material);

  const hemi = new THREE.HemisphereLight("#dfeaf5", "#5b6b4a", 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#fff3e0", 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  const sc = sun.shadow.camera;
  sc.left = -110;
  sc.right = 110;
  sc.top = 110;
  sc.bottom = -110;
  sc.near = 10;
  sc.far = 600;
  scene.add(sun, sun.target);

  // Ground: lawn, a paved plaza under the campus, and a ring road.
  const grass = keep(noiseTexture("#6d8a4f", 0.18, 3));
  grass.repeat.set(60, 60);
  const ground = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(1400, 1400)),
    keep(new THREE.MeshStandardMaterial({ map: grass, roughness: 1 })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const pave = keep(noiseTexture("#cdc4b2", 0.12, 7, 128));
  pave.repeat.set(30, 22);
  const plazaW = 10 * S;
  const plazaD = 7.6 * S;
  const plaza = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(plazaW, plazaD)),
    keep(new THREE.MeshStandardMaterial({ map: pave, roughness: 0.92 })),
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(0, 0.03, 0.2 * S);
  plaza.receiveShadow = true;
  scene.add(plaza);

  const roadMat = keep(new THREE.MeshStandardMaterial({ color: "#3a3c3f", roughness: 0.95 }));
  const roadGeo = keep(new THREE.RingGeometry(1, 1.06, 64, 1));
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.rotation.x = -Math.PI / 2;
  road.scale.set(plazaW * 0.78, plazaD * 0.92, 1);
  road.position.set(0, 0.02, 0.2 * S);
  road.receiveShadow = true;
  scene.add(road);

  // Lawn patches between buildings soften the plaza.
  const lawnMat = keep(new THREE.MeshStandardMaterial({ map: grass, roughness: 1, color: "#9fbf7a" }));
  const lawnGeo = keep(new THREE.CircleGeometry(1, 28));
  for (const [x, z, r] of [
    [-1.2, 0.6, 9],
    [1.4, -0.7, 7],
    [-2.9, 2.2, 6],
    [3.4, 1.8, 6.5],
  ] as const) {
    const m = new THREE.Mesh(lawnGeo, lawnMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x * S, 0.05, z * S);
    m.scale.setScalar(r);
    m.receiveShadow = true;
    scene.add(m);
  }

  // Buildings.
  const concrete = keep(new THREE.MeshStandardMaterial({ color: "#e4ddd0", roughness: 0.85 }));
  const darkTrim = keep(new THREE.MeshStandardMaterial({ color: "#4a4743", roughness: 0.7, metalness: 0.2 }));
  const roofMat = keep(new THREE.MeshStandardMaterial({ color: "#8d8a84", roughness: 0.95 }));
  const { map: winMap, glow: winGlow } = windowTextures();
  keep(winMap);
  keep(winGlow);
  const floors = new Map<string, Floor>();
  const zones = new Map<string, ZoneBuild>();
  const pickables: THREE.Object3D[] = [];
  const box = keep(new THREE.BoxGeometry(1, 1, 1));

  const addBox = (
    mat: THREE.Material | THREE.Material[],
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ) => {
    const m = new THREE.Mesh(box, mat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };

  for (const z of ZONES) {
    const rooms = grouped.get(z.id) ?? [];
    const { w, d, cx, cz } = zoneRect(z);
    let height = 0;
    if (z.id === "Z-OAT") {
      height = buildAmphitheatre(scene, keep, concrete, cx, cz, w, d, rooms, floors, pickables);
    } else {
      // Biggest room at the bottom; auditoria get a double-height storey.
      const list = rooms.length ? rooms : [null];
      for (const room of list) {
        const h = room?.type === "auditorium" ? STOREY * 2.2 : STOREY;
        const y0 = height;
        addBox(concrete, w, 0.8, d, cx, y0 + 0.4, cz);
        const win = keep(winMap.clone());
        const glow = keep(winGlow.clone());
        for (const t of [win, glow]) {
          t.repeat.set(Math.max(1, Math.round(w / 6)), 1);
          t.needsUpdate = true;
        }
        const mat = keep(
          new THREE.MeshStandardMaterial({
            map: win,
            emissiveMap: glow,
            emissive: new THREE.Color("#000"),
            roughness: 0.25,
            metalness: 0.35,
          }),
        );
        const mesh = addBox(
          [mat, mat, concrete, concrete, mat, mat],
          w - 0.6,
          h - 0.8,
          d - 0.6,
          cx,
          y0 + 0.8 + (h - 0.8) / 2,
          cz,
        );
        if (room) {
          mesh.userData = { roomId: room.id, zoneId: z.id };
          floors.set(room.id, { roomId: room.id, zoneId: z.id, mat, mesh });
        } else {
          mesh.userData = { zoneId: z.id };
        }
        pickables.push(mesh);
        // Vertical fins give the facade some depth and catch the light.
        const fins = Math.max(2, Math.round(w / 9));
        for (let f = 0; f <= fins; f++) {
          const fx = cx - w / 2 + (f / fins) * w;
          addBox(concrete, 0.35, h, 0.7, fx, y0 + h / 2, cz + d / 2);
        }
        height += h;
      }
      // Roof: parapet slab, plant boxes, and an entrance canopy.
      addBox(roofMat, w + 0.4, 0.9, d + 0.4, cx, height + 0.45, cz);
      if (z.id === "Z-MECH") {
        const shape = new THREE.Shape();
        shape.moveTo(-w / 2, 0);
        shape.lineTo(w / 2, 0);
        shape.lineTo(0, 3.2);
        shape.closePath();
        const g = keep(new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }));
        const roof = new THREE.Mesh(g, darkTrim);
        roof.position.set(cx, height + 0.9, cz - d / 2);
        roof.castShadow = true;
        scene.add(roof);
        height += 3.2;
      } else {
        const r = rng(z.x * 100 + z.y);
        for (let i = 0; i < 3; i++)
          addBox(
            darkTrim,
            2 + r() * 2,
            1.4,
            2 + r() * 2,
            cx + (r() - 0.5) * w * 0.6,
            height + 1.6,
            cz + (r() - 0.5) * d * 0.6,
          );
      }
      addBox(darkTrim, Math.min(10, w * 0.5), 0.35, 3.2, cx, 3.4, cz + d / 2 + 1.6);
      for (const s of [-1, 1])
        addBox(concrete, 0.4, 3.2, 0.4, cx + s * Math.min(4.5, w * 0.22), 1.6, cz + d / 2 + 3);
      height += 0.9;
    }
    zones.set(z.id, {
      zone: z,
      top: new THREE.Vector3(cx, height + 3, cz),
      door: new THREE.Vector3(cx, 1.7, cz + d / 2 + 9),
      box: {
        x0: cx - w / 2 - 0.8,
        x1: cx + w / 2 + 0.8,
        z0: cz - d / 2 - 0.8,
        z1: cz + d / 2 + (z.id === "Z-OAT" ? 0.8 : 3.6),
      },
    });
  }

  // Trees along the edge of the plaza and the avenue, kept clear of buildings.
  const r = rng(42);
  const spots: THREE.Vector3[] = [];
  const clear = (x: number, z: number) =>
    [...zones.values()].every(
      (b) => x < b.box.x0 - 3 || x > b.box.x1 + 3 || z < b.box.z0 - 3 || z > b.box.z1 + 3,
    );
  for (let i = 0; i < 260 && spots.length < 150; i++) {
    const a = r() * Math.PI * 2;
    const rad = 0.84 + r() * 0.35;
    const x = Math.cos(a) * plazaW * 0.5 * rad * 1.25;
    const z = Math.sin(a) * plazaD * 0.5 * rad * 1.25 + 0.2 * S;
    if (clear(x, z)) spots.push(new THREE.Vector3(x, 0, z));
  }
  for (let i = 0; i < 120 && spots.length < 190; i++) {
    const x = (r() - 0.5) * plazaW * 0.95;
    const z = (r() - 0.5) * plazaD * 0.95 + 0.2 * S;
    if (clear(x, z)) spots.push(new THREE.Vector3(x, 0, z));
  }
  const trunkGeo = keep(new THREE.CylinderGeometry(0.22, 0.34, 3.2, 6));
  const crownGeo = keep(new THREE.IcosahedronGeometry(2.3, 1));
  const trunkMat = keep(new THREE.MeshStandardMaterial({ color: "#5a4632", roughness: 1 }));
  const crownMat = keep(
    new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9, flatShading: true }),
  );
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, spots.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const greens = ["#4f7a3a", "#5e8a40", "#3f6b34", "#6f9445", "#557f3d"].map((c) => new THREE.Color(c));
  spots.forEach((p, i) => {
    const s = 0.8 + r() * 0.6;
    m4.compose(new THREE.Vector3(p.x, 1.6 * s, p.z), q, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m4);
    q.setFromEuler(new THREE.Euler(r(), r() * 3, r()));
    m4.compose(new THREE.Vector3(p.x, 4.2 * s, p.z), q, new THREE.Vector3(s, s * (0.9 + r() * 0.4), s));
    crowns.setMatrixAt(i, m4);
    crowns.setColorAt(i, greens[i % greens.length]!);
    q.identity();
  });
  for (const t of [trunks, crowns]) {
    t.castShadow = true;
    t.receiveShadow = true;
    scene.add(t);
  }

  // Lamp posts around the ring road; they glow at dusk.
  const lamps = keep(
    new THREE.MeshStandardMaterial({ color: "#fff4d6", emissive: "#ffd28a", emissiveIntensity: 0 }),
  );
  const poleGeo = keep(new THREE.CylinderGeometry(0.08, 0.12, 5, 6));
  const bulbGeo = keep(new THREE.SphereGeometry(0.32, 10, 8));
  const N = 28;
  const poles = new THREE.InstancedMesh(poleGeo, darkTrim, N);
  const bulbs = new THREE.InstancedMesh(bulbGeo, lamps, N);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const x = Math.cos(a) * plazaW * 0.78 * 1.08;
    const z = Math.sin(a) * plazaD * 0.92 * 1.08 + 0.2 * S;
    m4.makeTranslation(x, 2.5, z);
    poles.setMatrixAt(i, m4);
    m4.makeTranslation(x, 5.1, z);
    bulbs.setMatrixAt(i, m4);
  }
  poles.castShadow = true;
  scene.add(poles, bulbs);

  return {
    scene,
    sun,
    sky,
    hemi,
    lamps,
    floors,
    zones,
    pickables,
    dispose: () => {
      for (const d of disposables) d.dispose();
      trunks.dispose();
      crowns.dispose();
      poles.dispose();
      bulbs.dispose();
    },
  };
}

function buildAmphitheatre(
  scene: THREE.Scene,
  keep: <T extends { dispose: () => void }>(x: T) => T,
  concrete: THREE.Material,
  cx: number,
  cz: number,
  w: number,
  d: number,
  rooms: RoomLite[],
  floors: Map<string, Floor>,
  pickables: THREE.Object3D[],
) {
  const R = Math.min(w, d) * 0.62;
  for (let t = 0; t < 6; t++) {
    const g = keep(
      new THREE.CylinderGeometry(R - t * 2.2, R - t * 2.2, 0.55, 40, 1, false, Math.PI / 2, Math.PI),
    );
    const m = new THREE.Mesh(g, concrete);
    m.position.set(cx, 0.28 + (5 - t) * 0.55, cz + d * 0.15);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }
  const mat = keep(
    new THREE.MeshStandardMaterial({ color: "#2b2a2e", roughness: 0.6, emissive: new THREE.Color("#000") }),
  );
  const stage = new THREE.Mesh(keep(new THREE.BoxGeometry(R * 1.1, 1.1, 5)), mat);
  stage.position.set(cx, 0.55, cz + d * 0.15 + 4);
  stage.castShadow = true;
  stage.receiveShadow = true;
  scene.add(stage);
  const room = rooms[0];
  stage.userData = room ? { roomId: room.id, zoneId: "Z-OAT" } : { zoneId: "Z-OAT" };
  if (room) floors.set(room.id, { roomId: room.id, zoneId: "Z-OAT", mat, mesh: stage });
  pickables.push(stage);
  return 3.3;
}

/** Light a storey for its status. */
export function lookFloor(f: Floor, look: FloorLook) {
  const l = LOOK[look];
  f.mat.emissive.set(l.color);
  f.mat.emissiveIntensity = l.intensity;
}

/**
 * Sun for a teaching period: rises in the east around 06:00, sets in the west
 * around 18:30. Returns how much daylight is left (0 = night) for lamps.
 */
export function placeSun(c: Campus, hour: number) {
  const t = (hour - 6) / 12.5;
  const elevation = Math.max(-4, Math.sin(Math.PI * Math.min(1, Math.max(0, t))) * 62);
  const azimuth = 90 + t * 180;
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  const dir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  c.sky.material.uniforms.sunPosition!.value.copy(dir);
  c.sun.position.copy(dir).multiplyScalar(260);
  const day = THREE.MathUtils.clamp(elevation / 25, 0, 1);
  c.sun.intensity = 0.4 + day * 2.4;
  c.sun.color.set(day < 0.5 ? "#ffb070" : "#fff3e0");
  c.hemi.intensity = 0.35 + day * 0.85;
  c.lamps.emissiveIntensity = (1 - day) * 3;
  c.sun.shadow.needsUpdate = true;
  return day;
}

// ------------------------------------------------------------------ interiors

export type Occupant = {
  title: string;
  detail: string;
  used: number;
  tone: "lecture" | "lab" | "event" | "free";
};

export type Interior = {
  scene: THREE.Scene;
  /** Walkable box on the floor plane. */
  bounds: { x0: number; x1: number; z0: number; z1: number };
  spawn: THREE.Vector3;
  /** Point the camera looks at on entry (the board). */
  look: THREE.Vector3;
  /** Floor height under a point, so walking follows the tiers. */
  floorAt: (z: number) => number;
  dispose: () => void;
};

const TONE: Record<Occupant["tone"], string> = {
  lecture: "#c6ff3d",
  lab: "#ff9a6b",
  event: "#d946ef",
  free: "#9aa4ad",
};

/** Board / projector screen showing what runs in the room now. */
function boardTexture(room: RoomLite, occ: Occupant, when: string) {
  return canvasTexture(1024, 512, (g) => {
    const grd = g.createLinearGradient(0, 0, 1024, 512);
    grd.addColorStop(0, "#0d1416");
    grd.addColorStop(1, "#18222a");
    g.fillStyle = grd;
    g.fillRect(0, 0, 1024, 512);
    g.fillStyle = TONE[occ.tone];
    g.fillRect(0, 0, 14, 512);
    g.font = "600 34px ui-monospace, Menlo, monospace";
    g.fillStyle = "#8fa3ad";
    g.fillText(`${room.id} · ${room.name}`.slice(0, 44), 60, 80);
    g.fillText(when, 60, 128);
    g.font = "700 74px system-ui, sans-serif";
    g.fillStyle = "#fff";
    g.fillText(occ.title.slice(0, 24), 60, 250);
    g.font = "400 38px system-ui, sans-serif";
    g.fillStyle = "#cfd8dc";
    g.fillText(occ.detail.slice(0, 48), 60, 315);
    const ratio = room.capacity ? Math.min(1, occ.used / room.capacity) : 0;
    g.fillStyle = "#26323a";
    g.fillRect(60, 390, 900, 26);
    g.fillStyle = TONE[occ.tone];
    g.fillRect(60, 390, 900 * ratio, 26);
    g.font = "600 30px ui-monospace, Menlo, monospace";
    g.fillStyle = "#cfd8dc";
    g.fillText(`${occ.used} / ${room.capacity} seats`, 60, 462);
  });
}

export function buildInterior(room: RoomLite, occ: Occupant, when: string, daylight: number): Interior {
  const L = roomLayout(room.type, room.capacity);
  const scene = new THREE.Scene();
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => {
    disposables.push(x);
    return x;
  };
  const outdoor = L.furnishing === "arena";
  const W = L.width;
  const D = L.depth;
  const H = L.height + L.rows * L.rise;

  if (outdoor) {
    const sky = new Sky();
    sky.scale.setScalar(2000);
    sky.material.uniforms.sunPosition!.value.set(-0.3, 0.12 + daylight * 0.5, -0.6);
    scene.add(sky);
    keep(sky.geometry);
    keep(sky.material);
  } else {
    scene.background = new THREE.Color("#1a1d20");
  }
  scene.add(new THREE.HemisphereLight("#f4f1ea", "#4b4038", outdoor ? 0.6 + daylight : 1.2));
  const key = new THREE.DirectionalLight("#fff6e8", outdoor ? 0.4 + daylight * 1.8 : 0.9);
  key.position.set(W * 0.4, H * 2, D * 0.7);
  scene.add(key);

  const box = keep(new THREE.BoxGeometry(1, 1, 1));
  const add = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(box, mat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };

  // Shell: floor, walls with a window band, ceiling light panels.
  const wood = keep(noiseTexture("#a07a52", 0.12, 11, 128));
  wood.repeat.set(W / 3, D / 3);
  const floorMat = keep(
    new THREE.MeshStandardMaterial(
      outdoor ? { color: "#8a8377", roughness: 0.95 } : { map: wood, roughness: 0.7 },
    ),
  );
  add(floorMat, W + 1, 0.2, D + 1, 0, -0.1, D / 2);
  const wall = keep(new THREE.MeshStandardMaterial({ color: "#ece6dc", roughness: 0.9 }));
  const accent = keep(new THREE.MeshStandardMaterial({ color: "#39434a", roughness: 0.8 }));
  if (!outdoor) {
    add(wall, W, H, 0.2, 0, H / 2, -0.1);
    add(wall, W, H, 0.2, 0, H / 2, D + 0.1);
    add(wall, 0.2, H, D, W / 2 + 0.1, H / 2, D / 2);
    add(wall, 0.2, H, D, -W / 2 - 0.1, H / 2, D / 2);
    add(wall, W, 0.2, D, 0, H, D / 2);
    const sky = keep(
      new THREE.MeshStandardMaterial({
        color: "#000",
        emissive: "#bfe3ff",
        emissiveIntensity: 0.25 + daylight * 1.1,
      }),
    );
    for (let z = 2; z < D - 1.5; z += 3.2)
      add(sky, 0.05, Math.min(2, H * 0.4), 2.6, -W / 2, H * 0.55, z + 1.3);
    const panel = keep(
      new THREE.MeshStandardMaterial({ color: "#fff", emissive: "#fff8ec", emissiveIntensity: 1.4 }),
    );
    for (let x = -W / 2 + 2.5; x < W / 2 - 1; x += 4)
      for (let z = 2.5; z < D - 1; z += 4) add(panel, 1.6, 0.05, 1.6, x, H - 0.12, z);
    const lamp = new THREE.PointLight("#fff1dc", 18, 0, 1.6);
    lamp.position.set(0, H - 0.6, D / 2);
    scene.add(lamp);
  }

  // Front: board / screen with the live occupant, a lectern or stage.
  const board = keep(boardTexture(room, occ, when));
  const screen = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(1, 1)),
    keep(new THREE.MeshBasicMaterial({ map: board, toneMapped: false })),
  );
  const bw = Math.min(W * 0.6, 9);
  screen.scale.set(bw, bw / 2, 1);
  screen.position.set(0, outdoor ? 4.5 : Math.min(H - 0.6 - bw / 4, 1.2 + bw / 4), outdoor ? 0.9 : 0.06);
  scene.add(screen);
  if (room.features.includes("stage") || outdoor) add(accent, Math.min(W - 2, 14), 0.8, 3.5, 0, 0.4, 2.2);
  else add(accent, 1, 1.1, 0.6, W * 0.25, 0.55, 1.6);

  // Seating, instanced: desks + chairs, and people in the occupied seats.
  const seats = seatPositions(L, room.capacity);
  const used = Math.min(occ.used, seats.length);
  const desk = keep(new THREE.MeshStandardMaterial({ color: "#d8cdbb", roughness: 0.6 }));
  const chair = keep(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.7 }));
  const deskGeo =
    L.furnishing === "desks"
      ? keep(new THREE.BoxGeometry(L.pitchX * 0.92, 0.06, 0.5))
      : keep(new THREE.BoxGeometry(L.pitchX * 0.95, 0.08, 0.9));
  const chairGeo = keep(new THREE.BoxGeometry(0.46, 0.45, 0.46));
  const desks = new THREE.InstancedMesh(deskGeo, desk, seats.length);
  const chairs = new THREE.InstancedMesh(chairGeo, chair, seats.length);
  const people = new THREE.InstancedMesh(
    keep(new THREE.CapsuleGeometry(0.2, 0.55, 4, 8)),
    keep(new THREE.MeshStandardMaterial({ roughness: 0.8 })),
    Math.max(1, used),
  );
  const heads = new THREE.InstancedMesh(
    keep(new THREE.SphereGeometry(0.13, 10, 8)),
    keep(new THREE.MeshStandardMaterial({ color: "#8d5a3c", roughness: 0.7 })),
    Math.max(1, used),
  );
  const m4 = new THREE.Matrix4();
  const tone = new THREE.Color(TONE[occ.tone]);
  const empty = new THREE.Color("#7d858c");
  const shirts = ["#3a5f8f", "#c9473d", "#e8e2d4", "#2f2f35", "#5f8f5a", "#b38b3f", "#6c4f8f"].map(
    (c) => new THREE.Color(c),
  );
  let p = 0;
  for (const [i, s] of seats.entries()) {
    const deskY = s.y + 0.75;
    m4.makeTranslation(s.x, deskY, s.z - 0.25);
    desks.setMatrixAt(i, m4);
    m4.makeTranslation(s.x, s.y + 0.23, s.z + 0.2);
    chairs.setMatrixAt(i, m4);
    const taken = s.order < used;
    chairs.setColorAt(i, taken ? tone : empty);
    if (taken) {
      m4.makeTranslation(s.x, s.y + 0.8, s.z + 0.2);
      people.setMatrixAt(p, m4);
      people.setColorAt(p, shirts[(i * 7) % shirts.length]!);
      m4.makeTranslation(s.x, s.y + 1.32, s.z + 0.2);
      heads.setMatrixAt(p, m4);
      p++;
    }
  }
  people.count = p;
  heads.count = p;
  scene.add(desks, chairs, people, heads);

  // Computer labs get monitors; tiered halls get the steps under each row.
  if (L.furnishing === "computers") {
    const mon = new THREE.InstancedMesh(
      keep(new THREE.BoxGeometry(0.55, 0.36, 0.04)),
      keep(new THREE.MeshStandardMaterial({ color: "#111", emissive: "#4aa3ff", emissiveIntensity: 0.6 })),
      seats.length,
    );
    for (const [i, s] of seats.entries()) {
      m4.makeTranslation(s.x, s.y + 1.0, s.z - 0.45);
      mon.setMatrixAt(i, m4);
    }
    scene.add(mon);
  }
  if (L.rise > 0) {
    for (let r = 1; r < L.rows; r++)
      add(
        outdoor ? floorMat : accent,
        W,
        r * L.rise,
        L.pitchZ,
        0,
        (r * L.rise) / 2,
        L.front + r * L.pitchZ + L.pitchZ / 2,
      );
  }

  return {
    scene,
    bounds: { x0: -W / 2 + 0.6, x1: W / 2 - 0.6, z0: 0.8, z1: D - 0.6 },
    spawn: new THREE.Vector3(W / 2 - 1.4, 1.7 + Math.max(0, L.rows - 1) * L.rise, D - 1.2),
    look: screen.position.clone(),
    floorAt: (z) => (z < L.front ? 0 : Math.min(L.rows - 1, Math.floor((z - L.front) / L.pitchZ)) * L.rise),
    dispose: () => {
      for (const d of disposables) d.dispose();
      for (const m of [desks, chairs, people, heads]) m.dispose();
    },
  };
}
