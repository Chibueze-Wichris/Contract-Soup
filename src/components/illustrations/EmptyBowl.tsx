/** Inline SVG empty-state illustration: a contract page leaning on a steaming bowl. */
export function EmptyBowl({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 160" className={className} fill="none" role="img" aria-label="A contract page next to a bowl of soup">
      <ellipse cx="110" cy="146" rx="84" ry="8" fill="var(--border)" />
      {/* contract page */}
      <g transform="rotate(-6 70 80)">
        <rect x="42" y="22" width="76" height="98" rx="8" fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="1.5" />
        <rect x="54" y="38" width="36" height="5" rx="2.5" fill="var(--brand)" opacity="0.85" />
        <rect x="54" y="52" width="52" height="4" rx="2" fill="var(--border-strong)" />
        <rect x="54" y="62" width="46" height="4" rx="2" fill="var(--border-strong)" />
        <rect x="54" y="72" width="52" height="4" rx="2" fill="var(--amber-soft)" stroke="var(--amber)" strokeWidth="1" />
        <rect x="54" y="82" width="38" height="4" rx="2" fill="var(--border-strong)" />
        <rect x="54" y="92" width="50" height="4" rx="2" fill="var(--border-strong)" />
      </g>
      {/* bowl */}
      <path d="M94 88h96a48 48 0 0 1-96 0z" fill="var(--brand)" />
      <path d="M94 88h96a48 40 0 0 0-96 0z" fill="var(--brand-soft)" opacity="0.35" />
      <rect x="126" y="134" width="32" height="6" rx="3" fill="var(--brand)" />
      {/* steam */}
      <g stroke="var(--amber)" strokeWidth="4" strokeLinecap="round">
        <path d="M122 76c-6-7 6-12 0-20" />
        <path d="M142 76c-6-7 6-12 0-20" />
        <path d="M162 76c-6-7 6-12 0-20" />
      </g>
    </svg>
  );
}
