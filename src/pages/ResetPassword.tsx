import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Logo } from "@/components/layout/Logo";
import { Button, Card, Input, toast } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

/** Shown after the user clicks the link in a password-reset email. */
export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { session, loading, clearRecovery } = useAuthStore();
  const navigate = useNavigate();

  if (!supabase) return <Navigate to="/" replace />;
  if (!loading && !session) return <Navigate to="/login" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error: err } = await supabase!.auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(err.message);
    clearRecovery();
    toast.success("Password updated.");
    navigate("/", { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 text-ink">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <Card>
          <h1 className="text-lg font-semibold">Choose a new password</h1>
          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && (
              <p role="alert" className="text-sm text-high-ink">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" loading={busy}>
              Update password
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
