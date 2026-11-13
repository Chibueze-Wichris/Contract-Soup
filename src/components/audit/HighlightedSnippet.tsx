import { cn } from "@/lib/cn";

interface HighlightedSnippetProps {
  /** The contract wording. */
  text: string;
  /** The phrase to mark inside it. Nothing is marked when it is missing or not found. */
  match?: string;
  className?: string;
}

function findPhrase(text: string, match: string | undefined): { start: number; end: number } | null {
  const phrase = match?.trim();
  if (!phrase) return null;

  const exact = text.indexOf(phrase);
  if (exact !== -1) return { start: exact, end: exact + phrase.length };

  // Same words, but with different capitals or line breaks between them.
  const pattern = phrase
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const found = new RegExp(pattern, "i").exec(text);
  return found ? { start: found.index, end: found.index + found[0].length } : null;
}

/** Contract wording with the matched phrase marked. Uses the app's `mark.hit` style. */
export function HighlightedSnippet({ text, match, className }: HighlightedSnippetProps) {
  const range = findPhrase(text, match);
  return (
    <p className={cn("whitespace-pre-line break-words", className)}>
      {range ? (
        <>
          {text.slice(0, range.start)}
          <mark className="hit">{text.slice(range.start, range.end)}</mark>
          {text.slice(range.end)}
        </>
      ) : (
        text
      )}
    </p>
  );
}
