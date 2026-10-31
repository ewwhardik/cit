/** Brand mark: a lagoon wave over a row of period ticks (timetable + Chilika lagoon). */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="CIT Scheduler"
      className="shrink-0"
    >
      <defs>
        <linearGradient id="lagoon-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#lagoon-mark)" />
      <rect x="1.5" y="1.5" width="29" height="29" rx="8.5" fill="none" stroke="white" strokeOpacity="0.35" />
      <path
        d="M6 18.5c2.6-2.4 5.2-2.4 7.8 0s5.2 2.4 7.8 0 4-2.2 4.4-2"
        fill="none"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <g fill="white" fillOpacity="0.85">
        <rect x="7" y="8.5" width="3" height="3" rx="1" />
        <rect x="12" y="8.5" width="3" height="3" rx="1" />
        <rect x="17" y="8.5" width="3" height="3" rx="1" fillOpacity="0.45" />
        <rect x="22" y="8.5" width="3" height="3" rx="1" />
      </g>
      <rect x="9" y="23" width="14" height="2.2" rx="1.1" fill="white" fillOpacity="0.55" />
    </svg>
  );
}
