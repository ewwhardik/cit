/**
 * Offline navigator: matches a question to a page by keywords, so the guide
 * keeps working with no AI key, when the AI is rate-limited, or offline.
 * Pure and deterministic (unit-tested).
 */
import type { Page } from "@/lib/sitemap";

export type NavAction = { type: "navigate"; href: string; label: string } | { type: "tour" } | null;
export type NavReply = { reply: string; action: NavAction; source: "ai" | "guide" };

const TOUR =
  /\b(tour|guide me|walk ?through|how (do i|to) use|help me start|getting started|kaise use|samjha)/;
const GREETING = /^(hi|hello|hey|namaste|hii+|yo|good (morning|evening|afternoon))\b/;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function scorePage(text: string, p: Page): number {
  const t = ` ${norm(text)} `;
  let score = 0;
  for (const k of p.keywords)
    if (t.includes(` ${norm(k)} `) || t.includes(norm(k))) score += k.includes(" ") ? 4 : 3;
  // Label words match on their stem, so "approve" finds "Approvals" and "booking" finds "Book".
  for (const w of norm(p.label).split(" ")) if (w.length > 3 && t.includes(` ${w.slice(0, 5)}`)) score += 2;
  for (const w of norm(p.what).split(" ")) if (w.length > 4 && t.includes(` ${w} `)) score += 1;
  return score;
}

export function fallbackNavigator(text: string, pages: Page[]): NavReply {
  const t = norm(text);
  if (!t || GREETING.test(t)) {
    return {
      reply: `Hi! I'm Iru. I can take you to ${pages
        .slice(0, 4)
        .map((p) => p.label)
        .join(", ")} and more, or walk you through the whole app. What do you need?`,
      action: null,
      source: "guide",
    };
  }
  if (TOUR.test(t)) {
    return {
      reply: "Let's take the guided tour. I'll highlight each part and tell you what to do.",
      action: { type: "tour" },
      source: "guide",
    };
  }
  const ranked = pages.map((p) => ({ p, s: scorePage(text, p) })).sort((a, b) => b.s - a.s);
  const best = ranked[0];
  if (!best || best.s < 2) {
    return {
      reply:
        "I'm not sure which page that is. Try asking about timetables, exams, booking a venue, free rooms or approvals, or say 'tour'.",
      action: null,
      source: "guide",
    };
  }
  return {
    reply: `${best.p.label}: ${best.p.what} ${best.p.task}`,
    action: { type: "navigate", href: best.p.href, label: best.p.label },
    source: "guide",
  };
}
