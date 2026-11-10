import { Navigate, Outlet, useLocation } from "react-router-dom";
import { PageSkeleton } from "@/components/ui";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

/** Wrap protected routes. Without Supabase env vars the app stays open in local mode. */
export function RequireAuth() {
  const { session, loading, recovery } = useAuthStore();
  const location = useLocation();

  if (!isSupabaseConfigured) return <Outlet />;
  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <PageSkeleton />
      </div>
    );
  }
  if (recovery) return <Navigate to="/reset-password" replace />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
