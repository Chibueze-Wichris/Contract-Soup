import { useState } from "react";
import { CheckCircle2, Sparkles, XCircle } from "lucide-react";
import { Button, Card, CardHeader } from "@/components/ui";
import { checkAiReader, type AiReaderCheck } from "@/lib/aiReader";

/**
 * What the Gemini reader is, what it sends, and a button that asks the Edge Function whether it can
 * reach Gemini with the key it holds. The check sends no contract text. There is nowhere to type a
 * key here on purpose: the key lives in the Supabase project's secrets and never reaches the browser.
 */
export function AiReaderCard() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<AiReaderCheck | null>(null);

  async function check(): Promise<void> {
    setChecking(true);
    setResult(null);
    try {
      setResult(await checkAiReader());
    } finally {
      setChecking(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Gemini reader"
        description="An optional reader that understands what clauses mean. You choose it for each audit, on the first step."
      />
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
        <li>
          When you choose it, the text of the contract&rsquo;s pages is sent to Google Gemini through this project&rsquo;s
          Supabase function. The PDF file itself, your claims and your saved reports are never sent.
        </li>
        <li>The Gemini key is kept in the Supabase project&rsquo;s secrets. It is not part of this app and cannot be read here.</li>
        <li>
          The function keeps no copy of the text, and each request tells Gemini not to store it. Google&rsquo;s{" "}
          <a
            href="https://ai.google.dev/gemini-api/terms"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-brand underline underline-offset-2 hover:no-underline"
          >
            terms for the Gemini API
          </a>{" "}
          decide the rest. For real contracts, use a key from a Google project with billing turned on: under those terms,
          text sent with a key on the free plan may be used to improve Google&rsquo;s products and read by reviewers.
        </li>
        <li>The money checks always run on this device, on terms a person has confirmed.</li>
      </ul>

      <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-ink">Check the Gemini reader</h3>
          <p className="mt-0.5 text-sm text-muted">
            Asks the function whether it is deployed, has a key, and can reach the model. No contract text is sent.
          </p>
        </div>
        <Button variant="secondary" icon={<Sparkles className="h-4 w-4" />} loading={checking} onClick={() => void check()} className="shrink-0">
          Check AI reader
        </Button>
      </div>

      <div role="status" aria-live="polite">
        {result ? (
          <p className="mt-3 flex items-start gap-2 text-sm text-ink">
            {result.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-ink" aria-hidden="true" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-high-ink" aria-hidden="true" />
            )}
            <span className="min-w-0 break-words">
              <span className="font-medium">{result.ok ? "Ready." : "Not ready."}</span>{" "}
              {result.ok ? `The function reached Gemini and will use the model ${result.model}.` : result.message}
            </span>
          </p>
        ) : null}
      </div>
    </Card>
  );
}
