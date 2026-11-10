import { lazy } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";

// Every route is code-split so first load stays small.
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const NewAudit = lazy(() => import("@/pages/NewAudit"));
const SavedReports = lazy(() => import("@/pages/SavedReports"));
const Report = lazy(() => import("@/pages/Report"));
const Settings = lazy(() => import("@/pages/Settings"));
const NotFound = lazy(() => import("@/pages/NotFound"));

/**
 * HashRouter keeps deep links working on any static host
 * (GitHub Pages, Cloudflare Pages, Vercel) with no rewrite rules.
 */
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="audit/new" element={<NewAudit />} />
          <Route path="reports" element={<SavedReports />} />
          <Route path="reports/:id" element={<Report />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
