import { FilePlus2, FolderClosed, LayoutDashboard, Settings, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match nested routes too, e.g. /reports/:id keeps "Saved Reports" active. */
  end?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/audit/new", label: "New Audit", icon: FilePlus2 },
  { to: "/reports", label: "Saved Reports", icon: FolderClosed },
  { to: "/settings", label: "Settings", icon: Settings },
];

export const DISCLAIMER = "Analytical report for review by your legal team. Not legal advice.";
export const PRIVACY_LINE = "Your files never leave this device";
