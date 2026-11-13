import { Cpu, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useDraftAuditStore, type ReaderKind } from "@/store/useDraftAuditStore";

interface OptionProps {
  value: ReaderKind;
  checked: boolean;
  icon: ReactNode;
  title: string;
  children: ReactNode;
  onChoose: (value: ReaderKind) => void;
}

function Option({ value, checked, icon, title, children, onChoose }: OptionProps) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors duration-150",
        checked ? "border-brand bg-brand-soft" : "border-line hover:border-line-strong",
      )}
    >
      <input
        type="radio"
        name="contract-reader"
        value={value}
        checked={checked}
        onChange={() => onChoose(value)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <span className="text-brand" aria-hidden="true">
            {icon}
          </span>
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-muted">{children}</span>
      </span>
    </label>
  );
}

/**
 * Who reads the contract for this audit: the built-in reader on this device, or Google Gemini.
 * Gemini is only used after the box agreeing to send the contract's text has been ticked, and the
 * box is empty again for every audit.
 */
export function ReaderChoice() {
  const reader = useDraftAuditStore((s) => s.reader);
  const consent = useDraftAuditStore((s) => s.aiConsent);
  const setReader = useDraftAuditStore((s) => s.setReader);
  const setAiConsent = useDraftAuditStore((s) => s.setAiConsent);

  return (
    <fieldset className="mb-4">
      <legend className="text-sm font-semibold text-ink">Who reads the contract</legend>
      <div className="mt-2 grid gap-2 @lg:grid-cols-2">
        <Option value="local" checked={reader === "local"} icon={<Cpu className="h-4 w-4" />} title="Built-in reader" onChoose={setReader}>
          Finds 14 kinds of financial term by their wording. Works on this device. Nothing is sent anywhere.
        </Option>
        <Option value="gemini" checked={reader === "gemini"} icon={<Sparkles className="h-4 w-4" />} title="Gemini reader" onChoose={setReader}>
          Reads what clauses mean: conditions, exceptions, dates, notice periods and risks in the wording. Sends the
          contract&rsquo;s text to Google Gemini.
        </Option>
      </div>

      {reader === "gemini" ? (
        <div className="mt-3 rounded-xl border border-line bg-surface-2 p-4">
          <p className="text-sm font-medium text-ink">What the Gemini reader sends, and what it does not</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            <li>
              The text of the contract&rsquo;s pages goes to Google Gemini through your Supabase project. The PDF file and its
              name are not sent.
            </li>
            <li>Your claims file is never sent. The money checks are worked out on this device, as always.</li>
            <li>
              Each request tells Gemini not to store the text. Google&rsquo;s terms for the Gemini API decide the rest: with
              a key on Google&rsquo;s paid plan the text is not used to improve Google&rsquo;s products, and with a key on its
              free plan it may be, and may be read by reviewers. Whoever set up this app chose the key.
            </li>
            <li>Every term Gemini finds arrives unconfirmed, with the contract wording it rests on, for you to check.</li>
          </ul>
          <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm font-medium text-ink">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand"
              checked={consent}
              onChange={(e) => setAiConsent(e.target.checked)}
            />
            <span>I agree to send this contract&rsquo;s text to Google Gemini for this audit.</span>
          </label>
        </div>
      ) : null}
    </fieldset>
  );
}
