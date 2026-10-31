import { describe, expect, it } from "vitest";
import type { Role } from "@/server/db/schema";
import { fallbackNavigator } from "./navigator-fallback";
import { pagesFor } from "./sitemap";

const ROLES: Role[] = ["admin", "dept_coordinator", "faculty", "club"];

describe("fallbackNavigator (offline guide)", () => {
  it("sends a club rep to the booking page for an auditorium question", () => {
    const r = fallbackNavigator("where can I book the auditorium", pagesFor("club"));
    expect(r.action).toMatchObject({ type: "navigate", href: "/book" });
  });

  it("sends faculty to exams", () => {
    const r = fallbackNavigator("show my exams", pagesFor("faculty"));
    expect(r.action).toMatchObject({ type: "navigate", href: "/exams" });
  });

  it("understands Hinglish for free rooms", () => {
    const r = fallbackNavigator("khali room chahiye", pagesFor("club"));
    expect(r.action).toMatchObject({ type: "navigate", href: "/rooms" });
  });

  it("never sends a club rep to approvals, which they cannot open", () => {
    const r = fallbackNavigator("approve pending requests", pagesFor("club"));
    const href = r.action?.type === "navigate" ? r.action.href : null;
    expect(href).not.toBe("/approvals");
  });

  it("sends an admin to approvals for an approve request", () => {
    const r = fallbackNavigator("approve pending requests", pagesFor("admin"));
    expect(r.action).toMatchObject({ type: "navigate", href: "/approvals" });
  });

  it("starts the tour for a tour request", () => {
    const r = fallbackNavigator("take me on a tour", pagesFor("club"));
    expect(r.action).toEqual({ type: "tour" });
  });

  it("answers a greeting with a reply from Iru and no action", () => {
    const r = fallbackNavigator("hello", pagesFor("club"));
    expect(r.action).toBeNull();
    expect(r.reply).toContain("Iru");
  });

  it("returns no action for gibberish", () => {
    const r = fallbackNavigator("qwzx plk", pagesFor("club"));
    expect(r.action).toBeNull();
  });

  it("only ever navigates to pages the role is allowed to open", () => {
    const queries = [
      "where can I book the auditorium",
      "show my exams",
      "khali room chahiye",
      "approve pending requests",
      "change my timetable",
      "generate the timetable",
      "reset the demo data",
      "what if a teacher is absent",
      "show the schedule for my class",
      "qwzx plk",
    ];
    for (const role of ROLES) {
      const allowed = new Set(pagesFor(role).map((p) => p.href));
      for (const q of queries) {
        const r = fallbackNavigator(q, pagesFor(role));
        if (r.action?.type === "navigate") {
          expect(allowed.has(r.action.href), `${role} / "${q}" -> ${r.action.href}`).toBe(true);
        }
      }
    }
  });
});
