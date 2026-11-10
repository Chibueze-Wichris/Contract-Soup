import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { MobileTabBar } from "./MobileTabBar";
import { DisclaimerBar } from "./DisclaimerBar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PageSkeleton, Toaster } from "@/components/ui";
import { useResolvedTheme } from "@/lib/useResolvedTheme";

export function AppShell() {
  // Keeps the data-theme attribute in sync with the OS when preference is "system".
  useResolvedTheme();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-bg text-ink">
      <a
        href="#main"
        className="sr-only z-[70] rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-on focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>

      <Sidebar />

      <div className="flex min-h-screen flex-col pb-16 md:pb-0 md:pl-64">
        <Topbar />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 focus:outline-none">
          {/* Resetting the boundary on navigation lets users leave a crashed page */}
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<PageSkeleton />}>
              <div className="animate-fade-in">
                <Outlet />
              </div>
            </Suspense>
          </ErrorBoundary>
        </main>
        <DisclaimerBar />
      </div>

      <MobileTabBar />
      <Toaster />
    </div>
  );
}
