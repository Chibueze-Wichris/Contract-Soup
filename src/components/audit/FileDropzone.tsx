import { useId, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

interface FileDropzoneProps {
  /** Value for the file input's accept attribute, e.g. "application/pdf,.pdf". */
  accept: string;
  /** Main line, e.g. "Drag and drop your contract PDF here". */
  title: string;
  /** Label for the button that opens the file picker, e.g. "Choose PDF". */
  buttonLabel: string;
  /** Limits and other notes shown under the button. */
  hint?: ReactNode;
  icon?: ReactNode;
  onFile: (file: File) => void;
  /** Called when a drop cannot be used, for example several files at once. */
  onReject?: (message: string) => void;
  /** When set, no file is taken, and this is the reason given when one is offered. */
  blocked?: string;
}

/** Matches drop targets, so the page can tell a drop on one from a drop that missed. */
export const DROPZONE_SELECTOR = "[data-dropzone]";

/** True when a drag carries files (rather than text or a link). */
export function carriesFiles(types: readonly string[] | undefined): boolean {
  return Boolean(types?.includes("Files"));
}

/** Drop target with a button that opens the file picker. The button is the keyboard route; dropping is a shortcut. */
export function FileDropzone({ accept, title, buttonLabel, hint, icon, onFile, onReject, blocked }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const hintId = useId();

  function onDragEnter(e: DragEvent<HTMLDivElement>): void {
    if (!carriesFiles(e.dataTransfer.types)) return;
    e.preventDefault();
    depth.current += 1;
    setOver(true);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>): void {
    if (!carriesFiles(e.dataTransfer.types)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(): void {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    if (blocked) {
      onReject?.(blocked);
      return;
    }
    if (files.length > 1) {
      onReject?.("Add one file at a time.");
      return;
    }
    onFile(files[0]);
  }

  function onPick(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = ""; // so choosing the same file again still fires a change
    if (!file) return;
    if (blocked) {
      onReject?.(blocked);
      return;
    }
    onFile(file);
  }

  return (
    <div
      data-dropzone=""
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => (blocked ? onReject?.(blocked) : inputRef.current?.click())}
      className={cn(
        "flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors duration-150 sm:py-10",
        over ? "border-brand bg-brand-soft" : "border-line-strong bg-surface-2 hover:border-brand",
        blocked && "opacity-60",
      )}
    >
      {icon ? (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className="mt-4 text-base font-semibold text-ink">{over ? "Drop the file to add it" : title}</p>
      <p className="mt-1 text-sm text-muted">or choose it from this device</p>
      {/* The click bubbles to the drop target, which opens the picker. */}
      <Button variant="secondary" className="mt-4" icon={<FolderOpen className="h-4 w-4" />} aria-describedby={hint ? hintId : undefined}>
        {buttonLabel}
      </Button>
      {hint ? (
        <p id={hintId} className="mt-4 max-w-md text-xs text-muted">
          {hint}
        </p>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        tabIndex={-1}
        onChange={onPick}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
