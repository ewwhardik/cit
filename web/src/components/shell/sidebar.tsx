"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NavIcon } from "./icons";
import type { NavItem } from "./nav";

export function SidebarNav({ items, badges = {} }: { items: NavItem[]; badges?: Record<string, number> }) {
  const path = usePathname();
  const main = items.filter((i) => i.section !== "manage");
  const manage = items.filter((i) => i.section === "manage");
  return (
    <nav aria-label="Main" className="grid gap-4">
      <NavGroup items={main} path={path} badges={badges} />
      {manage.length ? (
        <div className="grid gap-1">
          <p className="px-2.5 text-[11px] font-medium text-gray-8">Manage</p>
          <NavGroup items={manage} path={path} badges={badges} />
        </div>
      ) : null}
    </nav>
  );
}

function NavGroup({
  items,
  path,
  badges,
}: {
  items: NavItem[];
  path: string;
  badges: Record<string, number>;
}) {
  return (
    <div className="grid gap-0.5">
      {items.map((item) => {
        const active = path === item.href || path.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href as Route}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-[13px] transition-colors duration-[120ms]",
              active
                ? "bg-gray-3 font-medium text-gray-10"
                : "text-gray-9 hover:bg-gray-3/70 hover:text-gray-10",
            )}
          >
            <NavIcon name={item.icon} className="size-4" />
            <span className="flex-1">{item.label}</span>
            {badges[item.href] ? (
              <span className="tabular rounded-full bg-accent px-1.5 text-[10px] leading-4 font-medium text-accent-fg">
                {badges[item.href]}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

/** Bottom tab bar for phones. */
export function MobileTabs({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 grid border-t border-gray-4 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => {
        const active = path === item.href || path.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href as Route}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]",
              active ? "text-accent" : "text-gray-9",
            )}
          >
            <NavIcon name={item.icon} className="size-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
