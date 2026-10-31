"use client";

import { Command } from "cmdk";
import { Search } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Kbd } from "@/components/ui/input";
import { NavIcon } from "./icons";
import type { NavItem } from "./nav";

export type Jump = { label: string; href: string; group: string };

/** ⌘K palette: pages plus every group / faculty / room timetable. Also handles "g x" shortcuts. */
export function CommandMenu({
  items,
  jumps,
  hotkeys = true,
}: {
  items: NavItem[];
  jumps: Jump[];
  hotkeys?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!hotkeys) return;
    let pendingG = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (pendingG) {
        pendingG = false;
        const hit = items.find((i) => i.shortcut === `g ${e.key}`);
        if (hit) router.push(hit.href as Route);
        return;
      }
      if (e.key === "g") {
        pendingG = true;
        clearTimeout(timer);
        timer = setTimeout(() => {
          pendingG = false;
        }, 800);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, router, hotkeys]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href as Route);
  };
  const groups = [...new Set(jumps.map((j) => j.group))];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full items-center gap-2 rounded-[var(--radius-control)] border border-gray-4 bg-surface px-2.5 text-[13px] text-gray-8 transition-colors hover:border-gray-6 max-md:size-11 max-md:justify-center max-md:p-0"
        aria-label="Search and jump (Ctrl+K)"
      >
        <Search className="size-4" strokeWidth={1.75} />
        <span className="flex-1 text-left max-md:hidden">Search…</span>
        <span className="max-md:hidden">
          <Kbd>⌘K</Kbd>
        </span>
      </button>
      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        label="Command menu"
        overlayClassName="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]"
        contentClassName="fixed left-1/2 top-[12vh] z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-[var(--radius-card)] border border-gray-5 bg-surface shadow-2xl"
      >
        <Command.Input
          placeholder="Jump to a page, group, faculty or room…"
          className="h-12 w-full border-b border-gray-4 bg-transparent px-4 text-[14px] outline-none placeholder:text-gray-8"
        />
        <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-6 text-center text-[13px] text-gray-9">No matches.</Command.Empty>
          <Command.Group heading="Pages" className="cmd-group">
            {items.map((i) => (
              <Command.Item
                key={i.href}
                value={`page ${i.label}`}
                onSelect={() => go(i.href)}
                className="cmd-item"
              >
                <NavIcon name={i.icon} className="size-4 text-gray-8" />
                <span className="flex-1">{i.label}</span>
                {i.shortcut ? <span className="tabular text-[11px] text-gray-8">{i.shortcut}</span> : null}
              </Command.Item>
            ))}
          </Command.Group>
          {groups.map((g) => (
            <Command.Group key={g} heading={g} className="cmd-group">
              {jumps
                .filter((j) => j.group === g)
                .map((j) => (
                  <Command.Item
                    key={j.href}
                    value={`${g} ${j.label}`}
                    onSelect={() => go(j.href)}
                    className="cmd-item"
                  >
                    <span className="flex-1 truncate">{j.label}</span>
                  </Command.Item>
                ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command.Dialog>
    </>
  );
}
