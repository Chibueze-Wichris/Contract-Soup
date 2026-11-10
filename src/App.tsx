import { Suspense, lazy } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { initAuth } from "@/store/useAuthStore";

// Every route is code-split so first load stays small.
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const NewAudit = lazy(() => import("@/pages/NewAudit"));
const SavedReports = lazy(() => import("@/pages/SavedReports"));
const Report = lazy(() => import("@/pages/Report"));
const Settings = lazy(() => import("@/pages/Settings"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const Login = lazy(() => import("@/pages/Login"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));

initAuth();

/**
 * HashRouter keeps deep links working on any static host
 * (GitHub Pages, Cloudflare Pages, Vercel) with no rewrite rules.
 */
export default function App() {
  return (
    <HashRouter>
      <Suspense fallback={null}>
        <Routes>
          {/* Public */}
          <Route path="login" element={<Login />} />
          <Route path="reset-password" element={<ResetPassword />} />

          {/* Protected */}
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<Dashboard />} />
              <Route path="audit/new" element={<NewAudit />} />
              <Route path="reports" element={<SavedReports />} />
              <Route path="reports/:id" element={<Report />} />
              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
