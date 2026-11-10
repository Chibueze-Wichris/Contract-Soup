import { useState } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, Button, Card, CardHeader, Input, Modal, SeverityBadge, SuccessBadge, toast } from "@/components/ui";
import { useThemeStore, type ThemePreference } from "@/store/useThemeStore";
import { cn } from "@/lib/cn";

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/** Phase 0: appearance settings plus a small UI kit preview. Thresholds and data tools arrive in Phase 4. */
export default function Settings() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  const [modalOpen, setModalOpen] = useState(false);
  const [tolerance, setTolerance] = useState("2");

  return (
    <>
      <PageHeader
        title="Settings"
        description="Appearance now. Check thresholds, currency and data tools arrive in a later phase."
        actions={<Badge tone="neutral">Backend: not connected (local mode)</Badge>}
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

        <Card>
          <CardHeader title="Component preview" description="Base components used across the app." />
          <div className="space-y-6">
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
