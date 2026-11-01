"use client";

import { type RefObject, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { groupRooms, type RoomLite, ZONES } from "@/lib/campus-zones";
import {
  buildCampus,
  buildInterior,
  type Campus,
  type FloorLook,
  type Interior,
  lookFloor,
  type Occupant,
  placeSun,
} from "./world";

export type Mode = "orbit" | "walk";
export type Inside = { room: RoomLite; occ: Occupant; when: string } | null;
export type ViewerHandle = {
  flyTo: (zoneId: string) => void;
  walkTo: (zoneId: string) => void;
  /** Hold / release a movement key from the on-screen pad. */
  press: (key: "f" | "b" | "l" | "r", down: boolean) => void;
  reset: () => void;
};

type Props = {
  /** Imperative controls (a prop, not ref: next/dynamic doesn't forward refs). */
  handle: RefObject<ViewerHandle | null>;
  rooms: RoomLite[];
  looks: Record<string, FloorLook>;
  labels: Record<string, string>;
  hour: number;
  mode: Mode;
  selectedZone: string | null;
  inside: Inside;
  onPick: (zoneId: string, roomId: string | null) => void;
  onReady?: () => void;
};

const EYE = 1.7;
const HOME = { pos: new THREE.Vector3(70, 95, 150), target: new THREE.Vector3(0, 0, 6) };
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Renderer, controls and loop for the 3D campus. Draws only when something
 * changed (camera move, walk, tween, new status), skips frames while off
 * screen, and builds the campus once; status updates only touch materials.
 */
export function CampusViewer({
  handle,
  rooms,
  looks,
  labels,
  hour,
  mode,
  selectedZone,
  inside,
  onPick,
  onReady,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const labelEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const api = useRef<{
    campus: Campus;
    invalidate: () => void;
    flyTo: (pos: THREE.Vector3, target: THREE.Vector3) => void;
    setWalk: (pos: THREE.Vector3, yaw: number) => void;
    keys: Set<string>;
    setDaylight: (h: number) => number;
    enter: (i: Inside) => void;
    setMode: (m: Mode) => void;
    select: (z: string | null) => void;
  } | null>(null);
  const grouped = useMemo(() => groupRooms(rooms), [rooms]);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const daylight = useRef(1);

  // One-time setup.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // Focusable so W A S D reaches it after a click (set here: lint rejects tabIndex on a div).
    el.tabIndex = 0;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.85;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "c3d-canvas";
    el.prepend(renderer.domElement);

    const campus = buildCampus(grouped);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    campus.scene.environment = env;
    campus.scene.environmentIntensity = 0.35;

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    camera.position.copy(HOME.pos);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(HOME.target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = 1.42;
    controls.minDistance = 18;
    controls.maxDistance = 340;
    controls.screenSpacePanning = false;

    let dirty = true;
    let visible = true;
    let mode: Mode = "orbit";
    let interior: Interior | null = null;
    let selected: string | null = null;
    const keys = new Set<string>();
    const walk = { pos: new THREE.Vector3(0, EYE, 70), yaw: 0, pitch: -0.05 };
    let tween: {
      t0: number;
      p0: THREE.Vector3;
      p1: THREE.Vector3;
      q0: THREE.Vector3;
      q1: THREE.Vector3;
    } | null = null;
    let savedOrbit: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
    const invalidate = () => {
      dirty = true;
    };
    controls.addEventListener("change", invalidate);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      invalidate();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) invalidate();
    });
    io.observe(el);

    // Walking: drag to look, keys or the on-screen pad to move.
    let down: { x: number; y: number; moved: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (Math.hypot(dx, dy) > 4) down.moved = true;
      if (mode === "walk" || interior) {
        walk.yaw -= e.movementX * 0.0045;
        walk.pitch = THREE.MathUtils.clamp(walk.pitch - e.movementY * 0.0035, -1.2, 1.2);
        invalidate();
      }
    };
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const onUp = (e: PointerEvent) => {
      const was = down;
      down = null;
      if (!was || was.moved || interior) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(campus.pickables, false)[0];
      const data = hit?.object.userData as { zoneId?: string; roomId?: string } | undefined;
      if (data?.zoneId) pickRef.current(data.zoneId, data.roomId ?? null);
    };
    const cv = renderer.domElement;
    cv.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    const KEY: Record<string, string> = {
      KeyW: "f",
      ArrowUp: "f",
      KeyS: "b",
      ArrowDown: "b",
      KeyA: "l",
      ArrowLeft: "l",
      KeyD: "r",
      ArrowRight: "r",
      ShiftLeft: "run",
      ShiftRight: "run",
    };
    const onKey = (e: KeyboardEvent) => {
      const k = KEY[e.code];
      if (!k || (mode !== "walk" && !interior)) return;
      e.preventDefault();
      if (e.type === "keydown") keys.add(k);
      else keys.delete(k);
    };
    el.addEventListener("keydown", onKey);
    el.addEventListener("keyup", onKey);
    const onBlur = () => keys.clear();
    window.addEventListener("blur", onBlur);

    const blocked = (x: number, z: number) => {
      if (interior) {
        const b = interior.bounds;
        return x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1;
      }
      if (Math.abs(x) > 170 || Math.abs(z - 3) > 130) return true;
      for (const zb of campus.zones.values()) {
        const b = zb.box;
        if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return true;
      }
      return false;
    };

    const fwd = new THREE.Vector3();
    const side = new THREE.Vector3();
    const look = new THREE.Vector3();
    function step(dt: number) {
      if (!keys.size) return false;
      const speed = (keys.has("run") ? 11 : 4.5) * (interior ? 0.6 : 1) * dt;
      fwd.set(-Math.sin(walk.yaw), 0, -Math.cos(walk.yaw));
      side.set(-fwd.z, 0, fwd.x);
      const dx = (keys.has("f") ? 1 : 0) - (keys.has("b") ? 1 : 0);
      const sx = (keys.has("r") ? 1 : 0) - (keys.has("l") ? 1 : 0);
      if (!dx && !sx) return false;
      const nx = walk.pos.x + (fwd.x * dx + side.x * sx) * speed;
      const nz = walk.pos.z + (fwd.z * dx + side.z * sx) * speed;
      // Slide along walls: try each axis on its own.
      if (!blocked(nx, walk.pos.z)) walk.pos.x = nx;
      if (!blocked(walk.pos.x, nz)) walk.pos.z = nz;
      if (interior) walk.pos.y = EYE + interior.floorAt(walk.pos.z);
      return true;
    }

    function placeWalkCamera() {
      camera.position.copy(walk.pos);
      look.set(
        walk.pos.x - Math.sin(walk.yaw) * Math.cos(walk.pitch),
        walk.pos.y + Math.sin(walk.pitch),
        walk.pos.z - Math.cos(walk.yaw) * Math.cos(walk.pitch),
      );
      camera.lookAt(look);
    }

    const v = new THREE.Vector3();
    function placeLabels() {
      const w = el!.clientWidth;
      const h = el!.clientHeight;
      for (const [id, zb] of campus.zones) {
        const node = labelEls.current.get(id);
        if (!node) continue;
        if (interior) {
          node.style.visibility = "hidden";
          continue;
        }
        v.copy(zb.top).project(camera);
        const behind = v.z > 1;
        const far = camera.position.distanceTo(zb.top);
        node.style.visibility = behind || (mode === "walk" && far > 120) ? "hidden" : "visible";
        node.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
        node.dataset.sel = String(id === selected);
      }
    }

    let last = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible) return;
      let active = false;
      if (tween) {
        const t = Math.min(1, (now - tween.t0) / 1100);
        const k = ease(t);
        camera.position.lerpVectors(tween.p0, tween.p1, k);
        controls.target.lerpVectors(tween.q0, tween.q1, k);
        camera.lookAt(controls.target);
        if (t >= 1) tween = null;
        active = true;
      } else if (mode === "walk" || interior) {
        active = step(dt);
        if (active || dirty) placeWalkCamera();
      } else {
        active = controls.update();
      }
      if (!active && !dirty) return;
      dirty = false;
      renderer.render(interior ? interior.scene : campus.scene, camera);
      placeLabels();
    };

    api.current = {
      campus,
      invalidate,
      keys,
      flyTo(pos, target) {
        tween = {
          t0: performance.now(),
          p0: camera.position.clone(),
          p1: pos,
          q0: controls.target.clone(),
          q1: target,
        };
      },
      setWalk(pos, yaw) {
        walk.pos.copy(pos);
        walk.yaw = yaw;
        walk.pitch = -0.04;
        invalidate();
      },
      setDaylight(h) {
        const d = placeSun(campus, h);
        renderer.toneMappingExposure = 0.55 + d * 0.35;
        renderer.shadowMap.needsUpdate = true;
        invalidate();
        return d;
      },
      setMode(m) {
        if (m === mode) return;
        mode = m;
        keys.clear();
        controls.enabled = m === "orbit" && !interior;
        if (m === "walk") {
          // Start at the picked building's door, else the south edge of the plaza facing campus.
          const door = selected ? campus.zones.get(selected)?.door : undefined;
          walk.pos.copy(door ?? new THREE.Vector3(0, EYE, 62));
          walk.yaw = 0;
          walk.pitch = -0.04;
        } else {
          camera.position.set(walk.pos.x + 40, 70, walk.pos.z + 70);
          controls.target.set(walk.pos.x, 0, walk.pos.z - 10);
          camera.lookAt(controls.target);
        }
        invalidate();
      },
      select(z) {
        selected = z;
        invalidate();
      },
      enter(i) {
        if (interior) {
          interior.dispose();
          interior = null;
        }
        if (i) {
          if (!savedOrbit) savedOrbit = { pos: camera.position.clone(), target: controls.target.clone() };
          interior = buildInterior(i.room, i.occ, i.when, daylight.current);
          walk.pos.copy(interior.spawn);
          walk.yaw = Math.atan2(walk.pos.x - interior.look.x, walk.pos.z - interior.look.z);
          walk.pitch = -0.12;
          controls.enabled = false;
          camera.fov = 62;
          camera.updateProjectionMatrix();
        } else {
          camera.fov = 50;
          camera.updateProjectionMatrix();
          if (savedOrbit && mode === "orbit") {
            camera.position.copy(savedOrbit.pos);
            controls.target.copy(savedOrbit.target);
            camera.lookAt(controls.target);
          }
          savedOrbit = null;
          controls.enabled = mode === "orbit";
        }
        keys.clear();
        invalidate();
      },
    };

    let cancelled = false;
    let compiled = false;
    const compiling = renderer
      .compileAsync(campus.scene, camera)
      .catch(() => undefined)
      .then(() => {
        compiled = true;
        if (cancelled) return;
        renderer.shadowMap.needsUpdate = true;
        raf = requestAnimationFrame(frame);
        requestAnimationFrame(() => readyRef.current?.());
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      cv.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("blur", onBlur);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("keyup", onKey);
      controls.dispose();
      renderer.domElement.remove();
      api.current = null;
      // Freeing GPU objects while compileAsync still polls them throws inside three.
      const free = () => {
        interior?.dispose();
        campus.dispose();
        env.dispose();
        pmrem.dispose();
        renderer.dispose();
      };
      if (compiled) free();
      else void compiling.then(free);
    };
  }, [grouped]);

  // Status → window light, without rebuilding anything.
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    for (const [id, f] of a.campus.floors) lookFloor(f, looks[id] ?? "free");
    a.invalidate();
  }, [looks]);

  useEffect(() => {
    if (api.current) daylight.current = api.current.setDaylight(hour);
  }, [hour]);

  useEffect(() => {
    api.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    api.current?.select(selectedZone);
  }, [selectedZone]);

  useEffect(() => {
    api.current?.enter(inside);
  }, [inside]);

  useImperativeHandle(handle, () => ({
    flyTo(zoneId) {
      const zb = api.current?.campus.zones.get(zoneId);
      if (!zb) return;
      const t = zb.top.clone().setY(zb.top.y * 0.45);
      api.current?.flyTo(t.clone().add(new THREE.Vector3(26, 30, 46)), t);
    },
    walkTo(zoneId) {
      const zb = api.current?.campus.zones.get(zoneId);
      if (zb) api.current?.setWalk(zb.door.clone(), 0);
    },
    press(key, down) {
      const k = api.current?.keys;
      if (!k) return;
      if (down) k.add(key);
      else k.delete(key);
    },
    reset() {
      api.current?.flyTo(HOME.pos.clone(), HOME.target.clone());
    },
  }));

  return (
    <div
      ref={host}
      role="application"
      className="c3d-host"
      aria-label="3D campus. Use W A S D or arrow keys to walk."
    >
      <div className="c3d-labels" aria-hidden>
        {ZONES.map((z) => (
          <div
            key={z.id}
            ref={(n) => {
              if (n) labelEls.current.set(z.id, n);
              else labelEls.current.delete(z.id);
            }}
            className="c3d-label"
          >
            <b>{z.short}</b>
            {labels[z.id] ? <span>{labels[z.id]}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
