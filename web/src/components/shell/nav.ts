import { PAGES, type Page, pagesFor, ROLE_LABEL } from "@/lib/sitemap";
import type { Role } from "@/server/db/schema";

/** Sidebar / command-palette entries come straight from the site map (src/lib/sitemap.ts). */
export type NavItem = Page;
export const NAV: NavItem[] = PAGES;
export { ROLE_LABEL };

export function navFor(role: Role) {
  return pagesFor(role);
}

export function mobileNavFor(role: Role) {
  const items = navFor(role).filter((n) => n.mobile);
  if (!items.some((i) => i.href === "/approvals")) {
    const req = NAV.find((n) => n.href === "/requests");
    if (req) items.push(req);
  }
  return items.slice(0, 5);
}
