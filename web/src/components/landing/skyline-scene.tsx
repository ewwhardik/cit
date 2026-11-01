"use client";

/**
 * The hero: the current timetable as a 3D skyline.
 *
 * X = periods (with the lunch gap), Z = days, Y = how many rooms are busy in
 * that slot, so tall stacks are the crowded hours. Each block is one real
 * session. On load (and on "Re-solve") the blocks start scattered and red,
 * like the clash-filled spreadsheet, and fall into their solved slots.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { clock, DAY_NAMES, KIND_COLOR, type Kind, type LandingBlock, periodHour } from "./types";

const CELL = 1;
const LUNCH_GAP = 0.7;
const ROW = 1.35;
const LEVEL = 0.27;
const BLOCK_H = 0.22;
const WIDTH = 9 * CELL + LUNCH_GAP;
const CLASH = new THREE.Color("#ff2d55");
const IDLE = new THREE.Color("#6e655a");
const DIM = new THREE.Color("#221d18");

type Props = {
  blocks: LandingBlock[];
  solved: boolean;
  /** Kinds to show; the others sink into the floor. */
  visible: Record<Kind, boolean>;
  /** Bump to replay the solve animation. */
  replay: number;
  /** Called once the shaders are compiled and the first frame is on screen. */
  onReady?: () => void;
};

type Hover = { block: LandingBlock; x: number; y: number } | null;

function xOf(period: number): number {
  return (period - 1) * CELL + (period >= 6 ? LUNCH_GAP : 0) - WIDTH / 2;
}

/** Lowest free level per day so multi-period labs stay flat. */
function levels(blocks: LandingBlock[]): number[] {
  const out = new Array<number>(blocks.length).fill(0);
  const used = new Map<string, true>();
  const order = blocks.map((b, i) => ({ b, i })).sort((x, y) => x.b.start - y.b.start || y.b.dur - x.b.dur);
  for (const { b, i } of order) {
    if (b.day < 0) continue;
    let l = 0;
    while (true) {
      let free = true;
      for (let p = b.start; p < b.start + b.dur; p++) if (used.has(`${b.day}:${p}:${l}`)) free = false;
      if (free) break;
      l++;
    }
    for (let p = b.start; p < b.start + b.dur; p++) used.set(`${b.day}:${p}:${l}`, true);
    out[i] = l;
  }
  return out;
}

function easeOutBack(t: number): number {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function labelSprite(text: string, color: string, size = 64): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = 256;
  canvas.height = 96;
  if (ctx) {
    ctx.font = `600 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 48);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(1.2, 0.45, 1);
  return sprite;
}

export default function SkylineScene({ blocks, solved, visible, replay, onReady }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(visible);
  const replayRef = useRef<() => void>(() => {});
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const [hover, setHover] = useState<Hover>(null);
  const [failed, setFailed] = useState(false);

  visibleRef.current = visible;

  useEffect(() => {
    if (replay > 0) replayRef.current();
  }, [replay]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      setFailed(true);
      readyRef.current?.();
      return;
    }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = matchMedia("(max-width: 767px)").matches;
    renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.25 : 1.5));
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = !small;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "pan-y";
    // Hidden until the shaders are compiled, then faded in over the placeholder.
    renderer.domElement.style.opacity = "0";
    renderer.domElement.style.transition = "opacity 0.9s cubic-bezier(0.16, 1, 0.3, 1)";

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.55;

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    const world = new THREE.Group();
    scene.add(world);

    const key = new THREE.DirectionalLight("#ffffff", 2.2);
    key.position.set(6, 12, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    key.shadow.radius = 6;
    scene.add(key);
    const rim = new THREE.DirectionalLight("#ff5a1f", 2.2);
    rim.position.set(-8, 4, -6);
    scene.add(rim);

    // Floor slab with day lanes and the lunch strip.
    const disposables: { dispose(): void }[] = [envTex, pmrem];
    const baseGeo = new RoundedBoxGeometry(WIDTH + 1.6, 0.24, 5 * ROW + 0.8, 4, 0.12);
    const baseMat = new THREE.MeshPhysicalMaterial({
      color: "#17130f",
      transparent: true,
      opacity: 0.92,
      roughness: 0.55,
      metalness: 0.2,
      clearcoat: 0.6,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = -0.14;
    base.receiveShadow = true;
    world.add(base);
    disposables.push(baseGeo, baseMat);

    const laneGeo = new RoundedBoxGeometry(WIDTH + 0.4, 0.02, ROW - 0.25, 2, 0.01);
    const laneMat = new THREE.MeshStandardMaterial({ color: "#211b15", roughness: 0.8 });
    disposables.push(laneGeo, laneMat);
    for (let d = 0; d < 5; d++) {
      const lane = new THREE.Mesh(laneGeo, laneMat);
      lane.position.set(0, 0, (d - 2) * ROW);
      lane.receiveShadow = true;
      world.add(lane);
      const label = labelSprite(DAY_NAMES[d] ?? "", "#efe6d2");
      label.position.set(-WIDTH / 2 - 1.1, 0.25, (d - 2) * ROW);
      world.add(label);
      disposables.push(label.material, label.material.map as THREE.Texture);
    }
    const lunchGeo = new THREE.BoxGeometry(LUNCH_GAP * 0.55, 0.03, 5 * ROW);
    const lunchMat = new THREE.MeshStandardMaterial({
      color: "#fff1d0",
      emissive: "#ffd28a",
      emissiveIntensity: 2.4,
    });
    const lunch = new THREE.Mesh(lunchGeo, lunchMat);
    lunch.position.set(xOf(6) - LUNCH_GAP / 2, 0.02, 0);
    world.add(lunch);
    disposables.push(lunchGeo, lunchMat);
    for (const p of [1, 4, 6, 9]) {
      const t = labelSprite(clock(periodHour(p)), "#8c8273", 54);
      t.position.set(xOf(p) + CELL / 2, 0.2, 3 * ROW + 0.15);
      t.scale.multiplyScalar(0.85);
      world.add(t);
      disposables.push(t.material, t.material.map as THREE.Texture);
    }

    // Blocks: one instanced mesh per duration so the rounded corners never stretch.
    const lv = levels(blocks);
    const byDur = new Map<number, number[]>();
    blocks.forEach((b, i) => {
      const list = byDur.get(b.dur) ?? [];
      list.push(i);
      byDur.set(b.dur, list);
    });

    type Item = {
      b: LandingBlock;
      from: THREE.Vector3;
      to: THREE.Vector3;
      q0: THREE.Quaternion;
      delay: number;
      color: THREE.Color;
      sink: number;
    };
    type Inst = { mesh: THREE.InstancedMesh; items: Item[] };
    const insts: Inst[] = [];
    const blockMat = new THREE.MeshPhysicalMaterial({
      roughness: 0.22,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      sheen: 0.4,
      sheenColor: new THREE.Color("#ffffff"),
    });
    disposables.push(blockMat);
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const scatter = () => {
      const r = rand(3, 7);
      const th = rand(0, Math.PI * 2);
      return new THREE.Vector3(Math.cos(th) * r, rand(3, 8), Math.sin(th) * r * 0.7);
    };

    for (const [dur, idx] of byDur) {
      const geo = new RoundedBoxGeometry(dur * CELL - 0.12, BLOCK_H, ROW - 0.38, 3, 0.09);
      disposables.push(geo);
      const mesh = new THREE.InstancedMesh(geo, blockMat, idx.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const inst: Inst = { mesh, items: [] };
      for (const i of idx) {
        const b = blocks[i];
        if (!b) continue;
        const level = lv[i] ?? 0;
        const item: Item = {
          b,
          from: scatter(),
          to:
            b.day >= 0
              ? new THREE.Vector3(
                  xOf(b.start) + (dur * CELL) / 2,
                  BLOCK_H / 2 + 0.02 + level * LEVEL,
                  (b.day - 2) * ROW,
                )
              : new THREE.Vector3(rand(-WIDTH / 2, WIDTH / 2), rand(1.2, 4.2), rand(-2.5, 2.5)),
          q0: new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(-2, 2), rand(-2, 2), rand(-2, 2))),
          delay: b.day >= 0 ? b.day * 0.12 + b.start * 0.07 + rand(0, 0.25) : rand(0, 0.6),
          color: new THREE.Color(b.day >= 0 ? KIND_COLOR[b.kind] : "#8c8273"),
          sink: 1,
        };
        mesh.setColorAt(inst.items.length, CLASH);
        inst.items.push(item);
      }
      world.add(mesh);
      insts.push(inst);
    }

    // Particles: warm dust drifting up through the city, pushed away from the pointer.
    const COUNT = small ? 700 : 1800;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(COUNT * 3);
    const pSeed = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      pPos[i * 3] = rand(-9, 9);
      pPos[i * 3 + 1] = rand(0, 7);
      pPos[i * 3 + 2] = rand(-6, 6);
      pSeed[i] = Math.random();
    }
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute("aSeed", new THREE.BufferAttribute(pSeed, 1));
    const pUniforms = {
      uTime: { value: 0 },
      uPx: { value: renderer.getPixelRatio() },
      uPointer: { value: new THREE.Vector3(99, 99, 99) },
    };
    const pMat = new THREE.ShaderMaterial({
      uniforms: pUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uPx; uniform vec3 uPointer;
        attribute float aSeed; varying float vSeed; varying float vFade;
        void main(){
          vec3 p = position;
          float t = uTime * (0.15 + aSeed * 0.35);
          p.y = mod(p.y + t, 7.0);
          p.x += sin(t * 1.3 + aSeed * 40.0) * 0.35;
          p.z += cos(t * 1.1 + aSeed * 23.0) * 0.35;
          vec3 d = p - uPointer;
          float k = exp(-dot(d, d) * 0.35);
          p += normalize(d + 0.0001) * k * 1.2;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (3.0 + aSeed * 6.0) * uPx * (14.0 / -mv.z);
          vSeed = aSeed;
          vFade = smoothstep(0.0, 1.0, p.y) * (1.0 - smoothstep(5.5, 7.0, p.y));
        }`,
      fragmentShader: /* glsl */ `
        varying float vSeed; varying float vFade;
        void main(){
          float r = length(gl_PointCoord - 0.5);
          float core = smoothstep(0.18, 0.0, r);
          float halo = smoothstep(0.5, 0.0, r) * 0.45;
          float a = core + halo;
          vec3 ember = vec3(1.0, 0.36, 0.12);
          vec3 lime = vec3(0.78, 1.0, 0.24);
          vec3 bone = vec3(0.94, 0.9, 0.82);
          vec3 c = vSeed < 0.45 ? ember : vSeed < 0.7 ? lime : bone;
          gl_FragColor = vec4(c, a * vFade * 0.8);
        }`,
    });
    const points = new THREE.Points(pGeo, pMat);
    world.add(points);
    disposables.push(pGeo, pMat);
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.2);
    const hitFloor = new THREE.Vector3();

    // Camera framing adapts to the host's aspect.
    function frame(w: number, h: number) {
      const aspect = w / Math.max(h, 1);
      camera.aspect = aspect;
      const dist = aspect < 0.9 ? 27 : aspect < 1.4 ? 21 : 19;
      camera.position.set(dist * 0.5, dist * 0.62, dist * 0.74);
      camera.lookAt(0, 0.4, 0);
      // On wide screens the headline sits on the left, so slide the city to the right.
      if (aspect >= 1.4) camera.setViewOffset(w, h, -w * 0.25, -h * 0.1, w, h);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(() => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      renderer.setSize(width, height, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      frame(width, height);
    });
    ro.observe(el);

    // Interaction: parallax tilt and hover pick.
    const pointer = new THREE.Vector2(9, 9);
    const tilt = { x: 0, y: 0 };
    const ray = new THREE.Raycaster();
    let hovered: { inst: Inst; k: number } | null = null;
    function onMove(e: PointerEvent) {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      if (ray.ray.intersectPlane(floor, hitFloor))
        pUniforms.uPointer.value.copy(world.worldToLocal(hitFloor));
      tilt.x = pointer.x;
      tilt.y = pointer.y;
      if (tip.current)
        tip.current.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 14}px)`;
    }
    function onLeave() {
      pointer.set(9, 9);
      pUniforms.uPointer.value.set(99, 99, 99);
      tilt.x = 0;
      tilt.y = 0;
    }
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    let t0 = performance.now();
    replayRef.current = () => {
      for (const inst of insts) for (const it of inst.items) it.from = scatter();
      t0 = performance.now();
    };
    if (reduced) t0 = -1e6;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const qi = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const col = new THREE.Color();
    const white = new THREE.Color("#ffffff");
    let running = true;
    let raf = 0;
    let lastPick = 0;

    function tick(now: number) {
      raf = requestAnimationFrame(tick);
      if (!running) return;
      const t = (now - t0) / 1000;
      const vis = visibleRef.current;

      world.rotation.y +=
        ((reduced ? 0 : tilt.x * 0.28 + Math.sin(now / 5200) * 0.06) - world.rotation.y) * 0.06;
      world.rotation.x += ((reduced ? 0 : -tilt.y * 0.06) - world.rotation.x) * 0.06;

      for (const inst of insts) {
        inst.items.forEach((it, k) => {
          const raw = Math.min(Math.max((t - it.delay) / 1.1, 0), 1);
          const e = easeOutBack(raw);
          pos.lerpVectors(it.from, it.to, e);
          if (!solved && !reduced) pos.y += Math.sin(now / 900 + k) * 0.12;
          q.slerpQuaternions(it.q0, qi, Math.min(raw * 1.4, 1));
          const shown = vis[it.b.kind];
          it.sink += ((shown ? 1 : 0.08) - it.sink) * 0.12;
          scl.set(1, it.sink, 1);
          if (solved) pos.y = pos.y * (0.4 + 0.6 * it.sink);
          m.compose(pos, q, scl);
          inst.mesh.setMatrixAt(k, m);
          col.copy(solved ? CLASH : IDLE).lerp(it.color, raw);
          if (!shown) col.lerp(DIM, 0.7);
          if (hovered && hovered.inst === inst && hovered.k === k) col.lerp(white, 0.45);
          inst.mesh.setColorAt(k, col);
        });
        inst.mesh.instanceMatrix.needsUpdate = true;
        if (inst.mesh.instanceColor) inst.mesh.instanceColor.needsUpdate = true;
      }

      if (now - lastPick > 50) {
        lastPick = now;
        ray.setFromCamera(pointer, camera);
        const hit = ray.intersectObjects(
          insts.map((i) => i.mesh),
          false,
        )[0];
        const inst = hit ? insts.find((i) => i.mesh === hit.object) : undefined;
        const next = inst && hit?.instanceId !== undefined ? { inst, k: hit.instanceId } : null;
        if (next?.inst !== hovered?.inst || next?.k !== hovered?.k) {
          hovered = next;
          const it = next ? next.inst.items[next.k] : undefined;
          setHover(it ? { block: it.b, x: 0, y: 0 } : null);
          renderer.domElement.style.cursor = next ? "pointer" : "";
        }
      }
      pUniforms.uTime.value = reduced ? 0 : now / 1000;
      renderer.render(scene, camera);
    }
    // Compile every program up front (in parallel where the driver allows it), so the
    // first frames don't stall the main thread while the city animates in.
    let disposed = false;
    const start = () => {
      if (disposed) return;
      t0 = reduced ? -1e6 : performance.now();
      raf = requestAnimationFrame(tick);
      requestAnimationFrame(() => {
        if (disposed) return;
        renderer.domElement.style.opacity = "1";
        readyRef.current?.();
      });
    };
    renderer.compileAsync(scene, camera).then(start, start);

    const io = new IntersectionObserver((entries) => {
      running = Boolean(entries[0]?.isIntersecting) && !document.hidden;
    });
    io.observe(el);
    const onVis = () => {
      running = !document.hidden;
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      for (const inst of insts) inst.mesh.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [blocks, solved]);

  if (failed) {
    return (
      <div className="grid h-full place-items-center text-[13px] text-white/50">
        3D needs WebGL. Everything below still works.
      </div>
    );
  }

  return (
    <div ref={host} className="relative h-full w-full">
      <div
        ref={tip}
        aria-hidden={!hover}
        className="pointer-events-none absolute top-0 left-0 z-10 transition-opacity duration-150"
        style={{ opacity: hover ? 1 : 0 }}
      >
        {hover ? (
          <div className="rounded-2xl border border-white/10 bg-[#0d0d1a]/85 px-3.5 py-2.5 shadow-2xl backdrop-blur-xl">
            <p className="font-mono text-[12px] text-white">{hover.block.id}</p>
            <p className="mt-0.5 text-[12px] text-white/60">
              {hover.block.day >= 0
                ? `${DAY_NAMES[hover.block.day] ?? ""} ${clock(periodHour(hover.block.start))}–${clock(
                    periodHour(hover.block.start + hover.block.dur - 1) + 1,
                  )} · ${hover.block.room}`
                : "Not placed yet: run Generate"}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-white/50">
              <span className="size-2 rounded-full" style={{ background: KIND_COLOR[hover.block.kind] }} />
              {hover.block.kind} · {hover.block.dur}h
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
