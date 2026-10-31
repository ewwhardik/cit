"use client";

import { useEffect, useState } from "react";

const TIPS = [
  "Press ⌘K (Ctrl+K) and type a room, teacher or group to jump straight to its timetable.",
  "Click any class, then 'Why here?' to see what blocks every other slot.",
  "Hinglish works: try 'seminar hall kal shaam 6 baje, 100 log' in Book a venue.",
  "Scrub the Right now panel to any period to find a free room in seconds.",
  "Nobody can approve their own request, not even the Admin.",
  "The compass button starts a step-by-step tour of the whole app.",
  "Resilience shows how the timetable copes if a busy teacher is away for a day.",
];

/** Iru's rotating tip, one at a time, changing every few seconds. */
export function Tip() {
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(Math.floor(Math.random() * TIPS.length));
    const t = setInterval(() => setI((n) => (n + 1) % TIPS.length), 9000);
    return () => clearInterval(t);
  }, []);
  return (
    <p
      key={i}
      className="tip-bubble relative rounded-2xl rounded-tl-md bg-gray-2 px-3 py-2 text-[12px] leading-relaxed text-gray-9"
    >
      <span className="font-medium text-gray-10">Tip · </span>
      {TIPS[i]}
    </p>
  );
}
