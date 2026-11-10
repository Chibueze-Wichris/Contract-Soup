import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "@/components/layout/Logo";
import { Button, Card, Input } from "@/components/ui";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

type Mode = "signin" | "signup" | "forgot";

const COPY: Record<Mode, { title: string; cta: string }> = {
  signin: { title: "Sign in to ContractSoup", cta: "Sign in" },
  signup: { title: "Create your account", cta: "Create account" },
  forgot: { title: "Reset your password", cta: "Send reset link" },
};

export default function Login() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const session = useAuthStore((s) => s.session);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  if (!isSupabaseConfigured || session) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    setNotice("");
    // Send people back to the site root. PKCE appends ?code=... and supabase-js handles it.
    const redirectTo = `${window.location.origin}/`;

    try {
      if (mode === "signin") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        navigate(from, { replace: true });
      } else if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo },
        });
        if (err) throw err;
        if (!data.session) setNotice("Check your email and click the confirmation link to finish signing up.");
      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (err) throw err;
        setNotice("If that email has an account, a reset link is on its way.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-ink">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <Card>
          <h1 className="text-lg font-semibold">{COPY[mode].title}</h1>
          <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate={false}>
            <Input
              label="Work email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {mode !== "forgot" && (
              <Input
                label="Password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={8}
                hint={mode === "signup" ? "At least 8 characters." : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
            {error && (
              <p role="alert" className="text-sm text-high-ink">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="text-sm text-brand">
                {notice}
              </p>
            )}
            <Button type="submit" className="w-full" loading={busy}>
              {COPY[mode].cta}
            </Button>
          </form>

          <div className="mt-5 flex flex-col gap-2 text-sm text-muted">
            {mode === "signin" && (
              <>
                <button type="button" className="text-left hover:text-ink" onClick={() => setMode("forgot")}>
                  Forgot your password?
                </button>
                <button type="button" className="text-left hover:text-ink" onClick={() => setMode("signup")}>
                  New here? Create an account
                </button>
              </>
            )}
            {mode !== "signin" && (
              <button type="button" className="text-left hover:text-ink" onClick={() => setMode("signin")}>
                Back to sign in
              </button>
            )}
          </div>
        </Card>
        <p className="mt-4 text-center text-xs text-muted">
          Analytical report for review by your legal team. Not legal advice.
        </p>
      </div>
    </div>
  );
}
