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
 * Absent currency is `null`.
 */
import { isSupportedCurrency } from "@/lib/fx/supported-currencies";

export interface CsvImportKnobs {
  skipHeaderRows: number | undefined;
  skipFooterRows: number | undefined;
  defaultCurrency: string | null;
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
  const header = parseSkip(formData.get("skipHeaderRows"), "skipHeaderRows");
  if (header.error) {
    return { skipHeaderRows: undefined, skipFooterRows: undefined, defaultCurrency: null, error: header.error };
  }
  const footer = parseSkip(formData.get("skipFooterRows"), "skipFooterRows");
  if (footer.error) {
    return { skipHeaderRows: undefined, skipFooterRows: undefined, defaultCurrency: null, error: footer.error };
  }

  let defaultCurrency: string | null = null;
  const ccyRaw = formData.get("defaultCurrency");
  if (ccyRaw && typeof ccyRaw === "string" && ccyRaw.trim()) {
    const code = ccyRaw.trim().toUpperCase();
    if (!isSupportedCurrency(code)) {
      return {
        skipHeaderRows: header.value,
        skipFooterRows: footer.value,
        defaultCurrency: null,
        error: `Unsupported defaultCurrency: ${code}`,
      };
    }
    defaultCurrency = code;
  }

  return {
    skipHeaderRows: header.value,
    skipFooterRows: footer.value,
    defaultCurrency,
  };
}
