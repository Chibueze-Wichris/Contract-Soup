import { useId, useRef, useState, type FormEvent } from "react";
import { TERM_CATEGORIES, categoryLabel } from "@/analyzer/categories";
import { UnitOptions } from "./TermFields";
import { Button, Input, Modal, Select, Textarea, toast } from "@/components/ui";
import { parseTermValue, usualUnit } from "@/lib/terms";
import { useDraftAuditStore } from "@/store/useDraftAuditStore";

interface AddTermModalProps {
  onClose: () => void;
}

/** Form for a term the reader missed. Mount it only while it is open, so it starts empty each time. */
export function AddTermModal({ onClose }: AddTermModalProps) {
  const pageCount = useDraftAuditStore((s) => s.contract.pageCount);
  const addTerm = useDraftAuditStore((s) => s.addTerm);
  const formId = useId();
  const categoryRef = useRef<HTMLSelectElement>(null);
  const pageRef = useRef<HTMLInputElement>(null);

  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [unitChosen, setUnitChosen] = useState(false);
  const [page, setPage] = useState("");
  const [snippet, setSnippet] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const pageNumber = Number(page);
  const pageValid = /^\d+$/.test(page.trim()) && pageNumber >= 1 && pageNumber <= pageCount;
  const categoryError = submitted && !category ? "Choose what kind of term this is." : undefined;
  const pageError = submitted && !pageValid ? `Enter a page from 1 to ${pageCount}.` : undefined;

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    setSubmitted(true);
    if (!category) {
      categoryRef.current?.focus();
      return;
    }
    if (!pageValid) {
      pageRef.current?.focus();
      return;
    }
    addTerm({ category, label: name, value: parseTermValue(value), unit, pageRef: pageNumber, snippet });
    toast.success("Term added and confirmed.");
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a term"
      description="For a term the reader missed. It is added as confirmed."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId}>
            Add term
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="grid gap-4">
        <Select
          ref={categoryRef}
          data-autofocus
          label="Kind of term"
          value={category}
          error={categoryError}
          onChange={(e) => {
            setCategory(e.target.value);
            if (!unitChosen) setUnit(usualUnit(e.target.value));
          }}
        >
          <option value="" disabled>
            Choose one
          </option>
          {TERM_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
        <Input
          label="Name"
          value={name}
          placeholder={category ? categoryLabel(category) : undefined}
          hint="Optional. For a fee, use the name it has in your claims file so its charges can be matched."
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="grid grid-cols-[2fr_3fr] gap-3">
          <Input
            label="Value"
            autoComplete="off"
            className="num"
            value={value}
            placeholder="24.50"
            onChange={(e) => setValue(e.target.value)}
          />
          <Select
            label="Unit"
            value={unit}
            onChange={(e) => {
              setUnit(e.target.value);
              setUnitChosen(true);
            }}
          >
            <UnitOptions current={unit} />
          </Select>
        </div>
        <Input
          ref={pageRef}
          label="Page"
          inputMode="numeric"
          className="max-w-44"
          value={page}
          error={pageError}
          onChange={(e) => setPage(e.target.value)}
        />
        <Textarea
          label="Contract wording"
          rows={4}
          value={snippet}
          hint="Optional. Paste the sentence from the contract so the report can quote it."
          maxLength={2000}
          onChange={(e) => setSnippet(e.target.value)}
        />
      </form>
    </Modal>
  );
}
