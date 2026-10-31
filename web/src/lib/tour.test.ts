import { describe, expect, it } from "vitest";
import type { Role } from "@/server/db/schema";
import { pagesFor } from "./sitemap";
import { tourFor } from "./tour";

describe("guided tour steps", () => {
  it("starts on the welcome card and ends on the navigator", () => {
    for (const role of ["admin", "dept_coordinator", "faculty", "club"] as Role[]) {
      const steps = tourFor(role);
      expect(steps[0]).toMatchObject({ id: "welcome", target: null });
      expect(steps[steps.length - 1]).toMatchObject({ id: "navigator" });
    }
  });

  it("never shows a club rep steps for pages they cannot open", () => {
    const forbidden = ["/approvals", "/generate", "/data", "/disruptions", "/resilience", "/versions"];
    const routes = tourFor("club").map((s) => s.route);
    for (const href of forbidden) expect(routes).not.toContain(href);
  });

  it("covers every page an admin can open, except the dashboard", () => {
    const routes = new Set(tourFor("admin").map((s) => s.route));
    for (const p of pagesFor("admin")) {
      if (p.href === "/dashboard") continue;
      expect(routes, `missing step for ${p.href}`).toContain(p.href);
    }
  });

  it("gives every step a unique id", () => {
    const ids = tourFor("admin").map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
