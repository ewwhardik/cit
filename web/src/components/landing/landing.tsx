"use client";

import Lenis from "lenis";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Cosmos } from "./cosmos";
import { CountUp, Cursor, MagneticLink, MissionClock, Reveal, Scramble, SplitWords, TiltCard } from "./fx";
import { LiveParser } from "./live-parser";
import { Orrery, type OrreryBody } from "./orrery";
import { Singularity } from "./singularity";
import { KIND_COLOR, KIND_LABEL, type Kind, type LandingData } from "./types";

export type { LandingData } from "./types";

const SkylineScene = dynamic(() => import("./skyline-scene"), { ssr: false });
const AgentsScene = dynamic(() => import("./agents-scene"), { ssr: false });

const AGENTS: {
  name: string;
  role: string;
  does: string;
  never: string;
  href: string;
  palette: [string, string];
}[] = [
  {
    name: "Booking agent",
    role: "English & Hinglish → form",
    does: "Reads “seminar hall kal shaam 6 baje, 100 log” and fills every field, flags what’s unclear and asks one follow-up.",
    never: "Can’t pick your priority or say a room is free.",
    href: "/book",
    palette: ["#7a1d00", "#ff5a1f"],
  },
  {
    name: "Change assistant",
    role: "Faculty requests, plain words",
    does: "“I can’t take Thursday mornings” becomes a concrete move, checked against every hard rule before you see it.",
    never: "Can’t touch other people’s classes or apply anything without an Admin.",
    href: "/assistant",
    palette: ["#2f4a00", "#c6ff3d"],
  },
  {
    name: "Explainer",
    role: "“Why is this at 8 AM?”",
    does: "The engine tries every other slot and records what blocks each one; the agent words it for humans.",
    never: "Can’t invent reasons. The raw facts stay on screen.",
    href: "/timetable",
    palette: ["#4a3f30", "#efe6d2"],
  },
];

const AGENT_PALETTES = AGENTS.map((a) => a.palette);

/** True once the element is within ~one screen of the viewport, so heavy 3D loads only when needed. */
function useNear(ref: React.RefObject<HTMLElement | null>) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "100% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return near;
}

const STEPS = [
  {
    n: "01",
    title: "You write it",
    body: "A WhatsApp-style message, a form, or a change file. English, Hinglish, vague or exact.",
  },
  {
    n: "02",
    title: "AI drafts",
    body: "The model fills a strict schema. Code re-reads clock times, resolves rooms and caps the category by role.",
  },
  {
    n: "03",
    title: "Code checks",
    body: "Every hard rule (H1–H14, bookings, exams) is checked by the same logic as the official validator.",
  },
  {
    n: "04",
    title: "A human approves",
    body: "Nothing changes until someone else approves it. Nobody can approve their own request.",
  },
];

export function Landing({ data, fontClass }: { data: LandingData; fontClass: string }) {
  const [visible, setVisible] = useState<Record<Kind, boolean>>({ lecture: true, tutorial: true, lab: true });
  const [replay, setReplay] = useState(0);
  const agentsStage = useRef<HTMLElement>(null);
  const orbSlots = useRef<(HTMLElement | null)[]>([]);
  const activeAgent = useRef(-1);
  const agentsNear = useNear(agentsStage);
  const kinds = (Object.keys(KIND_LABEL) as Kind[]).map((k) => ({
    k,
    n: data.blocks.filter((b) => b.kind === k).length,
  }));

  // Inertial smooth scrolling (off for reduced motion and touch, where native scrolling is better).
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce), (pointer: coarse)").matches) return;
    const lenis = new Lenis({ lerp: 0.09, anchors: { offset: -80 } });
    let raf = 0;
    const loop = (t: number) => {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);

  const ticker = [
    data.counts ? `${data.counts.sessions} sessions` : "189 sessions",
    data.report ? `${data.report.hard} hard-rule violations` : "0 clashes, by design",
    data.counts ? `${data.counts.rooms} rooms` : "27 rooms",
    data.report?.bookingScore != null
      ? `booking score ${data.report.bookingScore}`
      : "every booking gets a reason",
    data.counts ? `${data.counts.exams} midsem exams` : "41 midsem exams",
    "Hinglish welcome",
    data.counts ? `${data.counts.requests} Spectra requests` : "25 Spectra requests",
    "nobody approves their own request",
  ];

  return (
    <div className={cn("lx-root", fontClass)}>
      <Cosmos />
      <div aria-hidden className="lx-aurora" />
      <div aria-hidden className="lx-nebula" />
      <div aria-hidden className="lx-grain" />
      <Cursor />
      <Nav data={data} />

      {/* ---------------------------------------------------------------- hero */}
      <header className="relative mx-auto flex max-w-[1360px] flex-col px-4 pt-28 sm:px-6 lg:min-h-[100dvh] lg:pt-36">
        <div aria-hidden className="lx-horizon" />
        <OrbitRings />
        <div className="lx-hero-copy relative z-10 max-w-[760px] lg:pointer-events-none">
          <p className="lx-eyebrow">
            <span className="lx-dot" /> Chilika Institute of Technology — Spectra week
          </p>
          <h1 className="lx-display mt-6">
            <SplitWords text="Week 7," />
            <br />
            <span className="lx-serif-accent">
              <SplitWords text="solved." delay={260} />
            </span>
          </h1>
          <p className="lx-lede mt-7 max-w-[520px]">
            {data.counts?.sessions ?? 189} sessions, {data.counts?.rooms ?? 27} rooms, a tech fest and midsems
            in the same week. One engine places every class, settles every booking and repairs the timetable
            when plans change — with no clashes.
          </p>
          <div className="pointer-events-auto mt-9 flex flex-wrap items-center gap-3">
            <MagneticLink href={data.signedIn ? "/dashboard" : "#roles"} className="lx-btn-primary">
              {data.signedIn ? "Open dashboard" : "Step inside"}
              <Arrow />
            </MagneticLink>
            <MagneticLink href="#try" className="lx-btn-ghost">
              Type a request
            </MagneticLink>
          </div>
          <p className="lx-hud mt-10">
            <span>
              Mission clock <MissionClock />
            </span>
            <span>Orbit · Week 07</span>
            <span>
              Status{" "}
              <b className={data.report && data.report.hard > 0 ? "text-[#ff2d55]" : "text-[var(--lx-lime)]"}>
                {data.report ? (data.report.hard === 0 ? "● Nominal" : "● Anomaly") : "○ Awaiting launch"}
              </b>
            </span>
          </p>
        </div>

        <div className="relative mt-8 h-[400px] sm:h-[480px] lg:absolute lg:inset-x-0 lg:top-14 lg:bottom-16 lg:mt-0 lg:h-auto">
          <HeroScene blocks={data.blocks} solved={data.solved} visible={visible} replay={replay} />
          <div className="lx-dock absolute right-3 bottom-3 left-3 z-10 flex flex-wrap items-center gap-1.5 sm:left-auto lg:right-6 lg:bottom-0">
            {kinds.map(({ k, n }) => (
              <button
                key={k}
                type="button"
                aria-pressed={visible[k]}
                onClick={() => setVisible((v) => ({ ...v, [k]: !v[k] }))}
                className={cn("lx-chip", !visible[k] && "lx-chip-off")}
              >
                <span className="lx-swatch" style={{ background: KIND_COLOR[k] }} />
                {KIND_LABEL[k]} <span className="lx-mono opacity-50">{n}</span>
              </button>
            ))}
            <button type="button" onClick={() => setReplay((r) => r + 1)} className="lx-chip lx-chip-accent">
              ↻ {data.solved ? "Re-run solve" : "Shuffle"}
            </button>
          </div>
          <p className="lx-caption absolute top-3 right-3 z-10 max-w-[230px] text-right lg:top-20 lg:right-6">
            {data.solved
              ? "Live timetable · columns are hours, rows are days, height is rooms in use. Hover any block."
              : "Sessions waiting to be placed. Sign in as Admin → Generate to watch them land."}
          </p>
        </div>
      </header>

      {/* ---------------------------------------------------------------- ticker */}
      <div className="lx-marquees relative z-10 mt-10 lg:mt-0">
        <Marquee items={ticker} className="lx-marquee-back" reverse hidden />
        <Marquee items={ticker} className="lx-marquee" />
      </div>

      {/* ---------------------------------------------------------------- numbers */}
      <section className="relative z-10 mx-auto max-w-[1360px] px-4 py-24 sm:px-6 lg:py-32">
        <SectionHead index="01" eyebrow="The week, in numbers" title="Read straight from the engine." />
        <Reveal className="mt-12">
          <div className="lx-stats">
            {[
              ["Sessions", data.counts?.sessions],
              ["Rooms", data.counts?.rooms],
              ["Faculty", data.counts?.faculty],
              ["Groups", data.counts?.groups],
              ["Spectra asks", data.counts?.requests],
              ["Exams", data.counts?.exams],
            ].map(([label, n]) => (
              <div key={label as string} className="lx-stat">
                <p className="lx-stat-n">{typeof n === "number" ? <CountUp value={n} /> : "–"}</p>
                <p className="lx-stat-l">{label}</p>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={120}>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Metric
              label="Hard-rule violations"
              value={data.report ? String(data.report.hard) : "–"}
              tone={data.report?.hard === 0 ? "lime" : data.report ? "bad" : "idle"}
              hint="Clashes, capacity, lunch, availability"
            />
            <Metric
              label="Soft penalty"
              value={data.report ? String(data.report.soft) : "–"}
              tone={data.report ? "bone" : "idle"}
              hint="Lower is kinder to people"
            />
            <Metric
              label="Spectra booking score"
              value={
                data.report?.bookingScore != null
                  ? `${data.report.bookingScore}${data.report.bookingMax ? `/${data.report.bookingMax}` : ""}`
                  : "–"
              }
              tone={data.report?.bookingScore != null ? "ember" : "idle"}
              hint="Every decision comes with a reason"
            />
          </div>
          {!data.report ? (
            <p className="lx-caption mt-4">
              Scores appear after the first Generate, read from the engine&apos;s report.
            </p>
          ) : null}
        </Reveal>
      </section>

      {/* ---------------------------------------------------------------- orbit */}
      <section id="orbit" className="relative z-10 mx-auto max-w-[1360px] px-4 py-20 sm:px-6 lg:py-28">
        <SectionHead
          index="02"
          eyebrow="The system"
          title={
            <>
              Everything orbits <em>one engine.</em>
            </>
          }
          body="Rooms, people, groups, exams and fest bookings are all bodies in the same system. The solver at the centre holds them in place so no two ever collide. Hover a planet to stop time."
        />
        <Reveal delay={120} className="mt-10">
          <Orrery bodies={orreryBodies(data)} hard={data.report?.hard ?? null} />
        </Reveal>
      </section>

      {/* ---------------------------------------------------------------- agents */}
      <section
        ref={agentsStage}
        id="agents"
        className="relative z-10 mx-auto max-w-[1360px] px-4 py-20 sm:px-6 lg:py-28"
      >
        {agentsNear ? (
          <AgentsScene stage={agentsStage} slots={orbSlots} palettes={AGENT_PALETTES} active={activeAgent} />
        ) : null}
        <SectionHead
          index="03"
          eyebrow="AI helpers"
          title={
            <>
              Three agents. <em>None</em> of them get the final say.
            </>
          }
          body="They read, draft and explain. Whether something is valid is always decided by deterministic code, and if the AI is down the manual form still works."
        />
        <ul className="relative z-10 mt-14 grid gap-4 md:grid-cols-3">
          {AGENTS.map((a, i) => (
            <TiltCard
              as="li"
              key={a.name}
              className="lx-card flex flex-col p-6"
              onPointerEnter={() => {
                activeAgent.current = i;
              }}
              onPointerLeave={() => {
                activeAgent.current = -1;
              }}
            >
              <div
                ref={(el) => {
                  orbSlots.current[i] = el;
                }}
                aria-hidden
                className="relative mx-auto -mt-2 h-[200px] w-full"
              />
              <p className="lx-tag" style={{ color: a.palette[1], borderColor: `${a.palette[1]}55` }}>
                {a.role}
              </p>
              <h3 className="lx-h3 mt-4">{a.name}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-[var(--lx-bone)]/65">{a.does}</p>
              <p className="mt-4 flex gap-2.5 text-[14px] leading-relaxed text-[var(--lx-bone)]/45">
                <span aria-hidden className="lx-mono text-[var(--lx-ember)]">
                  ✕
                </span>
                {a.never}
              </p>
              <Link href={a.href as never} className="lx-link mt-6 self-start">
                Open {a.name.toLowerCase()} <Arrow />
              </Link>
            </TiltCard>
          ))}
        </ul>
      </section>

      {/* ---------------------------------------------------------------- try it */}
      <section
        id="try"
        className="relative z-10 mx-auto max-w-[1360px] scroll-mt-24 px-4 py-20 sm:px-6 lg:py-28"
      >
        <SectionHead
          index="04"
          eyebrow="Try it here"
          title={
            <>
              Type like you&apos;d text the <em>Dean&apos;s office.</em>
            </>
          }
          body="Pick a sample or write your own. Watch it become a booking, see a priority claim get capped and an impossible request get flagged."
        />
        <Reveal delay={100} className="mt-12">
          <LiveParser ctx={data.parseCtx} />
        </Reveal>
      </section>

      {/* ---------------------------------------------------------------- pipeline */}
      <Pipeline />

      {/* ---------------------------------------------------------------- roles */}
      <section
        id="roles"
        className="relative z-10 mx-auto max-w-[1360px] scroll-mt-24 px-4 py-20 sm:px-6 lg:py-28"
      >
        <SectionHead
          index="06"
          eyebrow="Demo accounts"
          title={
            <>
              Step in as <em>anyone.</em>
            </>
          }
          body={`One click signs you in. Password for all four: ${data.demoPassword}`}
        />
        <RoleCards accounts={data.accounts} password={data.demoPassword} signedIn={data.signedIn} />
      </section>

      {/* ---------------------------------------------------------------- finale */}
      <Finale />

      <footer className="relative z-10 mx-auto max-w-[1360px] px-4 pt-4 pb-12 sm:px-6">
        <div className="flex flex-col gap-3 border-t border-[var(--lx-line)] pt-6 text-[13px] text-[var(--lx-bone)]/45 sm:flex-row sm:items-center sm:justify-between">
          <p>Built for Crunch Week · Chilika Institute of Technology</p>
          <div className="flex gap-6">
            <Link href={"/login" as never} className="hover:text-[var(--lx-bone)]">
              Sign in
            </Link>
            <a href="https://github.com/ewwhardik/cit" className="hover:text-[var(--lx-bone)]">
              Source ↗
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SectionHead({
  index,
  eyebrow,
  title,
  body,
}: {
  index: string;
  eyebrow: string;
  title: React.ReactNode;
  body?: string;
}) {
  return (
    <Reveal className="relative z-10 grid gap-6 lg:grid-cols-[180px_1fr]">
      <p className="lx-index">({index})</p>
      <div className="max-w-[780px]">
        <p className="lx-eyebrow">
          <Scramble text={eyebrow} />
        </p>
        <h2 className="lx-h2 mt-4">{title}</h2>
        {body ? <p className="lx-lede mt-5 max-w-[600px]">{body}</p> : null}
      </div>
    </Reveal>
  );
}

function Nav({ data }: { data: LandingData }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <nav className={cn("lx-nav", scrolled && "lx-nav-on")}>
      <Link href="/" className="flex items-center gap-2.5">
        <span className="lx-logo" aria-hidden>
          C/
        </span>
        <span className="lx-wordmark">CIT Scheduler</span>
      </Link>
      <div className="hidden items-center gap-1 md:flex">
        {[
          ["#orbit", "The system"],
          ["#agents", "AI helpers"],
          ["#try", "Try it"],
          ["#how", "How it decides"],
          ["#roles", "Demo accounts"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="lx-navlink">
            {label}
          </a>
        ))}
      </div>
      <Link href={(data.signedIn ? "/dashboard" : "/login") as never} className="lx-btn-primary lx-btn-sm">
        {data.signedIn ? "Dashboard" : "Sign in"}
      </Link>
    </nav>
  );
}

function Pipeline() {
  const ref = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        setProgress(Math.min(Math.max((window.innerHeight * 0.75 - r.top) / (r.height * 0.8), 0), 1));
      });
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, []);
  return (
    <section
      ref={ref}
      id="how"
      className="relative z-10 mx-auto max-w-[1360px] scroll-mt-24 px-4 py-20 sm:px-6 lg:py-28"
    >
      <SectionHead
        index="05"
        eyebrow="How it decides"
        title={
          <>
            AI reads. Code decides. <em>People approve.</em>
          </>
        }
      />
      <div className="relative mt-14">
        <div
          aria-hidden
          className="absolute top-0 bottom-0 left-[21px] w-px bg-[var(--lx-line)] lg:top-[21px] lg:right-0 lg:bottom-auto lg:left-0 lg:h-px lg:w-auto"
        >
          <div className="lx-rail size-full" style={{ ["--p" as string]: progress } as React.CSSProperties} />
          <span
            className="lx-rail-comet"
            style={
              {
                ["--p" as string]: progress,
                opacity: progress > 0.01 && progress < 0.995 ? 1 : 0,
              } as React.CSSProperties
            }
          />
        </div>
        <ol className="grid gap-6 lg:grid-cols-4">
          {STEPS.map((s, i) => {
            const on = progress >= (i + 0.35) / STEPS.length;
            return (
              <li key={s.n} className="relative pl-16 lg:pt-16 lg:pl-0">
                <span className={cn("lx-node", on && "lx-node-on")}>{s.n}</span>
                <TiltCard
                  className={cn(
                    "lx-card p-6 transition-opacity duration-500",
                    on ? "opacity-100" : "opacity-50",
                  )}
                >
                  <h3 className="lx-h3">{s.title}</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-[var(--lx-bone)]/60">{s.body}</p>
                </TiltCard>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function RoleCards({
  accounts,
  password,
  signedIn,
}: {
  accounts: LandingData["accounts"];
  password: string;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tone = ["#ff5a1f", "#c6ff3d", "#efe6d2", "#ff9a6b"];

  async function go(email: string) {
    setBusy(email);
    setError(null);
    if (signedIn) await authClient.signOut();
    const { error } = await authClient.signIn.email({ email, password });
    if (error) {
      setError(error.message ?? "Sign-in failed. Has the database been seeded?");
      setBusy(null);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <>
      <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {accounts.map((a, i) => (
          <TiltCard as="li" key={a.email} className="lx-card p-0">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void go(a.email)}
              className="flex h-full w-full flex-col p-6 text-left disabled:cursor-wait"
            >
              <span className="flex items-center justify-between">
                <span className="lx-avatar" style={{ background: tone[i] }}>
                  {a.role[0]}
                </span>
                <span className="lx-mono text-[11px] text-[var(--lx-bone)]/35">0{i + 1}</span>
              </span>
              <span className="lx-h3 mt-8">{a.role}</span>
              <span className="mt-2 text-[14px] text-[var(--lx-bone)]/55">{a.note}</span>
              <span className="lx-mono mt-5 truncate text-[12px] text-[var(--lx-bone)]/35">{a.email}</span>
              <span className="lx-link mt-6">
                {busy === a.email ? "Signing in…" : "Continue"} <Arrow />
              </span>
            </button>
          </TiltCard>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-4 text-[14px] text-[var(--lx-ember)]">
          {error}
        </p>
      ) : null}
    </>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "lime" | "ember" | "bone" | "bad" | "idle";
}) {
  const color = {
    lime: "var(--lx-lime)",
    ember: "var(--lx-ember)",
    bone: "var(--lx-bone)",
    bad: "#ff2d55",
    idle: "rgb(239 230 210 / 0.3)",
  }[tone];
  return (
    <TiltCard className="lx-card p-6">
      <p className="lx-eyebrow">{label}</p>
      <p className="lx-metric mt-4" style={{ color }}>
        {value}
      </p>
      <p className="mt-2 text-[14px] text-[var(--lx-bone)]/45">{hint}</p>
    </TiltCard>
  );
}

/** The 3D skyline plus a CSS stand-in that holds its place until the first real frame. */
function HeroScene(props: Omit<React.ComponentProps<typeof SkylineScene>, "onReady">) {
  const [ready, setReady] = useState(false);
  return (
    <>
      <div aria-hidden className={cn("lx-scene-ghost", ready && "lx-scene-ghost-out")}>
        <div className="lx-ghost-grid" />
        <p className="lx-caption lx-ghost-label">
          <span className="lx-spinner" /> Assembling the week…
        </p>
      </div>
      <div className="lx-scene-mask absolute inset-0">
        <SkylineScene {...props} onReady={() => setReady(true)} />
      </div>
    </>
  );
}

/** Tilted orbit rings with satellites, drifting behind the hero headline. */
function OrbitRings() {
  return (
    <div aria-hidden className="lx-rings">
      {[0, 1, 2].map((i) => (
        <div key={i} className="lx-ring-orbit" style={{ "--i": i } as React.CSSProperties}>
          <div className="lx-ring-arm">
            <span className="lx-sat" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Marquee({
  items,
  className,
  reverse,
  hidden,
}: {
  items: string[];
  className: string;
  reverse?: boolean;
  hidden?: boolean;
}) {
  return (
    <div className={className} aria-hidden={hidden || undefined}>
      <div className={cn("lx-marquee-track", reverse && "lx-marquee-rev")}>
        {[0, 1].map((copy) => (
          <div key={copy} className="lx-marquee-row" aria-hidden={copy === 1 || undefined}>
            {items.map((t) => (
              <span key={t} className="lx-marquee-item">
                {t}
                <span className="lx-star" aria-hidden>
                  ✺
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function orreryBodies(data: LandingData): OrreryBody[] {
  const c = data.counts;
  return [
    {
      key: "groups",
      label: "Student groups",
      n: c?.groups ?? null,
      blurb: "Every cohort gets a week with no clashes, a free lunch hour and no day over the limit.",
      color: "#efe6d2",
    },
    {
      key: "rooms",
      label: "Rooms",
      n: c?.rooms ?? null,
      blurb: "Each placement is checked against seats, room type and features before it lands.",
      color: "#ff9a6b",
    },
    {
      key: "faculty",
      label: "Faculty",
      n: c?.faculty ?? null,
      blurb:
        "Availability is a hard wall; the slots people would rather avoid are kept as clear as possible.",
      color: "#c6ff3d",
    },
    {
      key: "sessions",
      label: "Sessions",
      n: c?.sessions ?? null,
      blurb: "Lectures, tutorials and labs, all placed in one solve, with multi-hour labs kept in one block.",
      color: "#ff5a1f",
    },
    {
      key: "exams",
      label: "Midsem exams",
      n: c?.exams ?? null,
      blurb: "Exams take priority over classes and never overlap for the same group.",
      color: "#cfe0ff",
    },
    {
      key: "requests",
      label: "Spectra bookings",
      n: c?.requests ?? null,
      blurb: "Fest requests are approved, moved or declined in priority order, each with a stated reason.",
      color: "#ffd28a",
    },
  ];
}

/** The last section: the wordmark as a star field the pointer can swallow. */
function Finale() {
  const readout = useRef<HTMLSpanElement>(null);
  return (
    <section id="singularity" className="relative z-10 mt-10 lg:mt-16">
      <div className="mx-auto max-w-[1360px] px-4 sm:px-6">
        <SectionHead
          index="07"
          eyebrow="One more thing"
          title={
            <>
              Go on, <em>bend spacetime.</em>
            </>
          }
          body="Move through the stars to pull them into orbit. Click to set off a supernova; gravity puts the week back together."
        />
      </div>
      <div className="relative mt-10">
        <Singularity
          text="CIT/Scheduler"
          onStats={(captured, total) => {
            if (readout.current)
              readout.current.textContent = `${captured.toLocaleString("en-IN")} / ${total.toLocaleString("en-IN")} stars in orbit`;
          }}
        />
      </div>
      <p className="lx-hud mx-auto -mt-6 max-w-[1360px] justify-between px-4 sm:px-6">
        <span ref={readout}>Charting stars…</span>
        <span className="hidden sm:inline-flex">Move · pull · click · supernova</span>
      </p>
    </section>
  );
}

function Arrow() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" className="lx-arrow">
      <path
        d="M3 8h10m0 0L9 4m4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
