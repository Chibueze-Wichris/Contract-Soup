import { NavLink } from "react-router-dom";
import { NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/cn";

/** Bottom tab bar for screens below md. Four tabs, 64px tall, safe-area aware. */
export function MobileTabBar() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid h-16 grid-cols-4">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex h-full flex-col items-center justify-center gap-1 text-xs font-medium transition-colors duration-150",
                  isActive ? "text-brand" : "text-muted hover:text-ink",
                )
              }
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
