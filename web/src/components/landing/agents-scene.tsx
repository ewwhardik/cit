"use client";

/**
 * One WebGL canvas behind the agent cards draws a living orb into each card's
 * orb slot (scissor viewports), so three 3D orbs cost one GPU context and
 * follow the responsive layout. Hovering a card wakes its orb up.
 */
import { type RefObject, useEffect, useRef } from "react";
import * as THREE from "three";

const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const vertex = /* glsl */ `
uniform float uTime; uniform float uWake;
varying vec3 vNormal; varying vec3 vView; varying float vNoise;
${NOISE}
void main(){
  float speed = 0.35 + uWake * 0.9;
  float n = snoise(normal * (1.4 + uWake * 0.6) + uTime * speed);
  vNoise = n;
  vec3 p = position + normal * n * (0.11 + uWake * 0.1);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const fragment = /* glsl */ `
uniform vec3 uA; uniform vec3 uB; uniform float uWake; uniform float uTime;
varying vec3 vNormal; varying vec3 vView; varying float vNoise;
void main(){
  float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.2);
  float band = 0.5 + 0.5 * sin(vNoise * 4.0 + uTime * 0.8 + vNormal.y * 3.0);
  vec3 base = mix(uA, uB, band);
  vec3 col = base * (0.35 + 0.5 * band) + fres * mix(uB, vec3(1.0), 0.5) * (1.1 + uWake * 0.8);
  float spec = pow(max(dot(reflect(-vView, vNormal), normalize(vec3(0.4, 0.8, 0.6))), 0.0), 24.0);
  col += spec * 0.7;
  gl_FragColor = vec4(col, 0.92 + fres * 0.08);
}`;

type Props = {
  /** Section to cover with the canvas. */
  stage: RefObject<HTMLElement | null>;
  /** Slot elements, one per agent, in the same order as `palettes`. */
  slots: RefObject<(HTMLElement | null)[]>;
  palettes: [string, string][];
  /** Index of the hovered card, or -1. */
  active: RefObject<number>;
};

export default function AgentsScene({ stage, slots, palettes, active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const section = stage.current;
    if (!canvas || !section) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      return;
    }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setScissorTest(true);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    camera.position.set(0, 0, 4.4);
    const geo = new THREE.IcosahedronGeometry(1, 32);
    const uniforms = palettes.map(([a, b]) => ({
      uTime: { value: 0 },
      uWake: { value: 0 },
      uA: { value: new THREE.Color(a) },
      uB: { value: new THREE.Color(b) },
    }));
    const mats = uniforms.map(
      (u) =>
        new THREE.ShaderMaterial({
          vertexShader: vertex,
          fragmentShader: fragment,
          transparent: true,
          uniforms: u,
        }),
    );
    const orb = new THREE.Mesh(geo, mats[0]);
    scene.add(orb);
    const wake = palettes.map(() => 0);

    const ro = new ResizeObserver(() => {
      renderer.setSize(section.clientWidth, section.clientHeight, false);
    });
    ro.observe(section);

    let running = true;
    let raf = 0;
    function tick(now: number) {
      raf = requestAnimationFrame(tick);
      if (!running) return;
      const t = reduced ? 0 : now / 1000;
      const cr = canvas!.getBoundingClientRect();
      renderer.setClearColor(0x000000, 0);
      renderer.setScissor(0, 0, cr.width, cr.height);
      renderer.clear();
      slots.current.forEach((slot, i) => {
        const mat = mats[i];
        if (!slot || !mat) return;
        const r = slot.getBoundingClientRect();
        if (r.bottom < cr.top || r.top > cr.bottom || r.width === 0) return;
        const x = r.left - cr.left;
        const y = cr.bottom - r.bottom;
        renderer.setViewport(x, y, r.width, r.height);
        renderer.setScissor(x, y, r.width, r.height);
        camera.aspect = r.width / r.height;
        camera.updateProjectionMatrix();
        const w = (wake[i] ?? 0) + ((active.current === i ? 1 : 0) - (wake[i] ?? 0)) * 0.08;
        wake[i] = w;
        uniforms[i]!.uTime.value = t + i * 7.3;
        uniforms[i]!.uWake.value = w;
        orb.material = mat;
        orb.rotation.set(t * 0.15 + i, t * 0.22, 0);
        orb.scale.setScalar(1 + w * 0.08);
        renderer.render(scene, camera);
      });
    }
    raf = requestAnimationFrame(tick);

    const io = new IntersectionObserver((entries) => {
      running = Boolean(entries[0]?.isIntersecting);
    });
    io.observe(section);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      geo.dispose();
      for (const m of mats) m.dispose();
      renderer.dispose();
    };
  }, [stage, slots, palettes, active]);

  return (
    <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 z-20 size-full" />
  );
}
