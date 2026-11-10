import { Link } from "react-router-dom";
import { Lock, Plus } from "lucide-react";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { buttonClasses } from "@/components/ui";
import { PRIVACY_LINE } from "@/lib/nav";

export function Topbar() {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6 lg:px-8">
      {/* Mobile shows the logo, desktop shows the privacy reassurance */}
      <Link to="/" aria-label="ContractSoup home" className="md:hidden">
        <Logo />
      </Link>
      <p className="hidden items-center gap-2 text-sm text-muted md:flex">
        <Lock className="h-4 w-4 text-brand" aria-hidden="true" />
        {PRIVACY_LINE}
      </p>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Link to="/audit/new" className={buttonClasses("primary", "md", "gap-1.5")}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Start new audit</span>
          <span className="sm:hidden">New</span>
        </Link>
      </div>
    </header>
  );
}
