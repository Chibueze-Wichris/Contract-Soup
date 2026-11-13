import { useState } from "react";
import { ChevronRight, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AiReaderCard } from "@/components/settings/AiReaderCard";
import { DataToolsCard } from "@/components/settings/DataToolsCard";
import { ThresholdsCard } from "@/components/settings/ThresholdsCard";
import { Badge, Button, Card, CardHeader, Input, Modal, SeverityBadge, SuccessBadge, toast } from "@/components/ui";
import { useThemeStore, type ThemePreference } from "@/store/useThemeStore";
import { AI_READER_AVAILABLE } from "@/lib/aiReader";
import { cn } from "@/lib/cn";
import { isSupabaseConfigured } from "@/lib/supabase";

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/** Appearance, the check thresholds, the Gemini reader (in builds with sign-in), tools for the saved reports, and a preview of the base components. */
export default function Settings() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  const [modalOpen, setModalOpen] = useState(false);
  const [tolerance, setTolerance] = useState("2");

  return (
    <>
      <PageHeader
        title="Settings"
        description="Appearance, check thresholds and your saved reports."
        actions={
          <Badge tone={isSupabaseConfigured ? "brand" : "neutral"}>
            {isSupabaseConfigured ? "Backend: Supabase connected" : "Backend: not connected (local mode)"}
          </Badge>
        }
      />

      <div className="grid gap-6">
        <Card>
          <CardHeader title="Appearance" description="Follows your system setting unless you choose a theme." />
          <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-lg border border-line bg-surface-2 p-1">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
              const active = preference === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPreference(value)}
                  className={cn(
                    "inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors duration-150",
                    active ? "bg-surface text-ink shadow-soft" : "text-muted hover:text-ink",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </div>
        </Card>

        <ThresholdsCard />

        {AI_READER_AVAILABLE ? <AiReaderCard /> : null}

        <DataToolsCard />

        {/* A developer aid from the first phase. Closed until asked for, so it is not mistaken for real settings. */}
        <Card padded={false}>
          <details className="group">
            <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)] gap-x-2 px-5 py-4 focus-visible:outline-offset-[-2px] sm:px-6 [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className="mt-1 h-4 w-4 text-muted transition-transform duration-150 group-open:rotate-90"
                aria-hidden="true"
              />
              <h2 className="text-base font-semibold text-ink">Component preview</h2>
              <span className="col-start-2 mt-1 text-sm text-muted">
                Base components used across the app. Nothing in here changes your settings.
              </span>
            </summary>
            <div className="space-y-6 border-t border-line px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-center gap-3">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
                <Button loading>Loading</Button>
                <Button disabled>Disabled</Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity="high" />
                <SeverityBadge severity="medium" />
                <SeverityBadge severity="low" />
                <SuccessBadge>Confirmed</SuccessBadge>
                <Badge tone="brand">High confidence</Badge>
                <Badge tone="amber">Needs legal review</Badge>
                <Badge>Open</Badge>
              </div>

              <div className="grid max-w-xl gap-4 sm:grid-cols-2">
                <Input
                  label="Admin fee tolerance"
                  value={tolerance}
                  onChange={(e) => setTolerance(e.target.value)}
                  suffix="%"
                  inputMode="decimal"
                  hint="Differences under this are ignored."
                />
                <Input label="Invalid example" defaultValue="abc" error="Enter a number, such as 2.5." />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={() => setModalOpen(true)}>
                  Open modal
                </Button>
                <Button variant="secondary" onClick={() => toast.success("Settings saved on this device.")}>
                  Success toast
                </Button>
                <Button variant="secondary" onClick={() => toast.error("That file could not be read.")}>
                  Error toast
                </Button>
              </div>

              <p className="num text-display font-semibold text-ink">$128,450</p>
            </div>
          </details>
        </Card>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Delete this report"
        description="This removes the report from this device. It cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setModalOpen(false);
                toast.info("Nothing was deleted. This is a preview.");
              }}
            >
              Delete report
            </Button>
          </>
        }
      >
        <p className="text-muted">Focus stays inside this dialog. Press Escape to close it.</p>
      </Modal>
    </>
  );
}
