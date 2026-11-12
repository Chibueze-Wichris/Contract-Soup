import { useEffect, useId, useRef, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, Card } from "@/components/ui";

interface StepShellProps {
  title: string;
  description?: ReactNode;
  /** Move keyboard focus to the heading when the step appears, so the change of step is announced. */
  focusHeading: boolean;
  /**
   * Names what the step is showing right now, e.g. "empty", "reading" or "ready". When it changes, the
   * control that had focus has often just been removed (a Cancel or Remove button). Focus then goes to
   * the heading instead of being lost.
   */
  view?: string;
  children: ReactNode;
}

/** The card every wizard step sits in: heading, intro, then the step's content. */
export function StepShell({ title, description, focusHeading, view, children }: StepShellProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const lastView = useRef(view);

  useEffect(() => {
    if (!focusHeading) return;
    // A new step starts at the top of the page, with the stepper in view.
    window.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
    // Only when the step first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (lastView.current === view) return;
    lastView.current = view;
    const active = document.activeElement;
    if (!active || active === document.body) headingRef.current?.focus();
  }, [view]);

  return (
    <Card>
      {/* A size container, so the step lays itself out by the room it has rather than by the window width. */}
      <section aria-labelledby={headingId} className="@container">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="w-fit text-lg font-semibold text-ink">
          {title}
        </h2>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
        <div className="mt-5">{children}</div>
      </section>
    </Card>
  );
}

interface StepFooterProps {
  /** Leave out on the first step. */
  onBack?: () => void;
  /** Short text next to the main button, for example why it cannot be used yet. */
  note?: ReactNode;
  /** The main button. */
  children: ReactNode;
}

/** Back on the left, the main button on the right. Stacked in the same order on narrow screens. */
export function StepFooter({ onBack, note, children }: StepFooterProps) {
  return (
    <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5 @lg:flex-row @lg:items-center @lg:justify-between">
      {onBack ? (
        <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack}>
          Back
        </Button>
      ) : (
        <span className="hidden @lg:block" aria-hidden="true" />
      )}
      <div className="flex flex-col gap-3 @lg:flex-row @lg:items-center">
        {note ? <p className="text-xs text-muted @lg:max-w-xs @lg:text-right">{note}</p> : null}
        {children}
      </div>
    </div>
  );
}
