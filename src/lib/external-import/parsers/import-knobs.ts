/**
 * Shared FormData parser for the CSV import "parser knobs" — skip header/footer
 * rows + default currency (FINLYNQ-54 + default-currency fix). Used by both
 * `/api/import/preview` and `/api/import/csv-map` so the validation (0–100 skip
 * range, `isSupportedCurrency` check) stays in one place and matches the
 * `/api/import/staging/upload` contract.
 *
 * Returns `{ error }` set when a value is out of range; the caller surfaces it
 * as a 400. **Absent skip fields stay `undefined`** (NOT 0) so the pipeline can
 * distinguish "not passed" from "passed as 0" — that's what lets a saved
 * template's own stored skip win via `req.skipHeaderRows ?? tpl.skipHeaderRows`.
 * Absent currency / date-format are `null` ("auto" → null too).
 */
import { isSupportedCurrency } from "@/lib/fx/supported-currencies";
import type { DateFormatOverride } from "@/lib/import-templates";

const DATE_FORMATS: DateFormatOverride[] = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"];

function isDateFormatOverride(v: string): v is DateFormatOverride {
  return (DATE_FORMATS as string[]).includes(v);
}

export interface CsvImportKnobs {
  skipHeaderRows: number | undefined;
  skipFooterRows: number | undefined;
  defaultCurrency: string | null;
  dateFormatOverride: DateFormatOverride | null;
  error?: string;
}

function parseSkip(
  raw: FormDataEntryValue | null,
  label: string,
): { value: number | undefined; error?: string } {
  if (raw && typeof raw === "string" && raw.trim()) {
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0 || n > 100) {
      return { value: undefined, error: `${label} must be an integer between 0 and 100` };
    }
    return { value: n };
  }
  return { value: undefined };
}

export function parseCsvImportKnobs(formData: globalThis.FormData): CsvImportKnobs {
  const base = { skipHeaderRows: undefined, skipFooterRows: undefined, defaultCurrency: null, dateFormatOverride: null } as const;
  const header = parseSkip(formData.get("skipHeaderRows"), "skipHeaderRows");
  if (header.error) {
    return { ...base, error: header.error };
  }
  const footer = parseSkip(formData.get("skipFooterRows"), "skipFooterRows");
  if (footer.error) {
    return { ...base, error: footer.error };
  }

  let defaultCurrency: string | null = null;
  const ccyRaw = formData.get("defaultCurrency");
  if (ccyRaw && typeof ccyRaw === "string" && ccyRaw.trim()) {
    const code = ccyRaw.trim().toUpperCase();
    if (!isSupportedCurrency(code)) {
      return {
        ...base,
        skipHeaderRows: header.value,
        skipFooterRows: footer.value,
        error: `Unsupported defaultCurrency: ${code}`,
      };
    }
    defaultCurrency = code;
  }

  let dateFormatOverride: DateFormatOverride | null = null;
  const dfRaw = formData.get("dateFormatOverride");
  if (dfRaw && typeof dfRaw === "string" && dfRaw.trim()) {
    const v = dfRaw.trim();
    if (v !== "auto") {
      if (!isDateFormatOverride(v)) {
        return {
          ...base,
          skipHeaderRows: header.value,
          skipFooterRows: footer.value,
          defaultCurrency,
          error: "dateFormatOverride must be one of: auto, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD",
        };
      }
      dateFormatOverride = v;
    }
  }

  return {
    skipHeaderRows: header.value,
    skipFooterRows: footer.value,
    defaultCurrency,
    dateFormatOverride,
  };
}
