import { NavLink } from "react-router-dom";
import { Lock } from "lucide-react";
import { Logo } from "./Logo";
import { Badge } from "@/components/ui";
import { NAV_ITEMS, PRIVACY_LINE } from "@/lib/nav";
import { cn } from "@/lib/cn";

/** Desktop navigation. Hidden below the md breakpoint, where MobileTabBar takes over. */
export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface md:flex">
      <div className="flex h-16 items-center px-5">
        <NavLink to="/" aria-label="ContractSoup home" className="rounded-lg">
          <Logo />
        </NavLink>
      </div>

      <nav aria-label="Main" className="flex-1 px-3 py-2">
        <ul className="space-y-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "group flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150",
                    isActive
                      ? "bg-brand-soft text-brand"
                      : "text-muted hover:bg-surface-2 hover:text-ink",
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="m-3 rounded-xl border border-line bg-surface-2 p-4">
        <div className="flex items-start gap-2.5">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
          <p className="text-xs text-muted">
            <span className="block font-medium text-ink">{PRIVACY_LINE}</span>
            Files are read in your browser and saved only in local storage.
          </p>
        </div>
        <div className="mt-3">
          <Badge tone="neutral">Backend: not connected (local mode)</Badge>
        </div>
      </div>
    </aside>
  );
}
