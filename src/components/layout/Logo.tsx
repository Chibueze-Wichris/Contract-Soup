import { cn } from "@/lib/cn";

/** Bowl-and-steam mark. Bowl follows the brand token, steam is soup amber. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("h-8 w-8", className)}
      role="img"
      aria-label="ContractSoup logo"
      fill="none"
    >
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <path d="M6.5 16.5h19a9.5 9.5 0 0 1-19 0z" fill="var(--brand-on)" />
      <path d="M11 24.8h10" stroke="var(--brand)" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M12.5 13c-1.2-1.3 1.2-2.2 0-3.6M16 13c-1.2-1.3 1.2-2.2 0-3.6M19.5 13c-1.2-1.3 1.2-2.2 0-3.6"
        stroke="var(--amber)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-base font-semibold tracking-tight text-ink">ContractSoup</span>
    </span>
  );
}
