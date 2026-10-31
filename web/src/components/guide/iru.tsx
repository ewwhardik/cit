import { cn } from "@/lib/utils";

/**
 * Iru, an Irrawaddy dolphin: the species Chilika Lake is known for. Round
 * head, no beak, small fin. Pure SVG; blinks and bobs gently (still for
 * reduced-motion users).
 */
export function Iru({
  size = 40,
  className,
  mood = "happy",
}: {
  size?: number;
  className?: string;
  mood?: "happy" | "think";
}) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className={cn("iru shrink-0", className)}>
      <defs>
        <linearGradient id="iru-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9fb4c7" />
          <stop offset="1" stopColor="#6f879c" />
        </linearGradient>
      </defs>
      {/* tail */}
      <path d="M8 40c-4-2-6-6-5-9 3 1 6 3 8 6l2-6c3 2 3 6 1 9z" fill="#6f879c" />
      {/* body */}
      <path
        d="M10 38c2-12 13-22 27-22 11 0 20 7 21 16 1 8-6 14-16 14H22c-6 0-11-3-12-8z"
        fill="url(#iru-body)"
      />
      {/* belly */}
      <path d="M22 44c6 3 18 3 26 0-4 4-10 5-15 5s-9-2-11-5z" fill="#dfe8ef" opacity=".85" />
      {/* fin */}
      <path d="M30 18c2-5 6-7 9-7-1 3-2 6-1 9z" fill="#6f879c" />
      {/* flipper */}
      <path d="M33 40c3 3 4 7 2 9-3-2-5-5-5-8z" fill="#5f768a" />
      {/* eye */}
      <g className="iru-eye">
        <ellipse cx="46" cy="30" rx="2.4" ry="2.6" fill="#1b232b" />
        <circle cx="46.9" cy="29.1" r=".8" fill="#fff" />
      </g>
      {/* cheek + smile */}
      <ellipse cx="51" cy="35" rx="2.6" ry="1.5" fill="#ff8a6b" opacity=".55" />
      {mood === "happy" ? (
        <path
          d="M49 38.5c2 1.4 5 1.3 7-.6"
          stroke="#1b232b"
          strokeWidth="1.4"
          fill="none"
          strokeLinecap="round"
        />
      ) : (
        <path d="M50 39h5" stroke="#1b232b" strokeWidth="1.4" strokeLinecap="round" />
      )}
      {/* blowhole sparkle */}
      <path d="M38 12l1-3 1 3 3 1-3 1-1 3-1-3-3-1z" fill="var(--accent)" className="iru-spark" />
    </svg>
  );
}
