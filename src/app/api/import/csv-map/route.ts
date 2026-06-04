import { NextRequest, NextResponse } from "next/server";
import { csvToRawTransactionsWithMapping, extractCsvHeaders, trimCsvRows } from "@/lib/csv-parser";
import { previewImport } from "@/lib/import-pipeline";
import { parseCsvImportKnobs } from "@/lib/external-import/parsers/import-knobs";
import { requireAuth } from "@/lib/auth/require-auth";
import { safeErrorMessage } from "@/lib/validate";
import { sourceTagFor } from "@/lib/tx-source";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth.response;

  try {
    const formData = await request.formData() as unknown as globalThis.FormData;
    const file = formData.get("file") as File;
    const mappingJson = formData.get("columnMapping") as string;
    const defaultAccount = formData.get("defaultAccount") as string | null;

    if (!file || !mappingJson) {
      return NextResponse.json({ error: "Missing file or columnMapping" }, { status: 400 });
    }

    const mapping: Record<string, string> = JSON.parse(mappingJson);
    if (!mapping.date || !mapping.amount) {
      return NextResponse.json({ error: "date and amount mappings are required" }, { status: 400 });
    }

    // FINLYNQ — parser knobs from the column-mapping dialog's "Import options":
    // trim junk header/footer rows BEFORE header detection + parsing so the
    // preview matches what the user mapped against, and stamp the chosen default
    // currency on rows that have no Currency column.
    const knobs = parseCsvImportKnobs(formData);
    if (knobs.error) {
      return NextResponse.json({ error: knobs.error }, { status: 400 });
    }

    const rawText = await file.text();
    const text = trimCsvRows(rawText, knobs.skipHeaderRows ?? 0, knobs.skipFooterRows ?? 0);

    // Also return headers for template saving
    const headers = extractCsvHeaders(text);

    const { rows, errors: parseErrors } = csvToRawTransactionsWithMapping(
      text,
      mapping,
      undefined,
      knobs.defaultCurrency,
    );

    // Apply default account if no account column mapped
    let processedRows = defaultAccount
      ? rows.map((r) => ({ ...r, account: r.account || defaultAccount }))
      : rows;

    // Issue #62: stamp source:csv on every row.
    const csvTag = sourceTagFor("csv");
    processedRows = processedRows.map((r) => {
      const existing = (r.tags ?? "").split(",").map((t) => t.trim()).filter((t) => t);
      if (existing.some((t) => t.toLowerCase() === csvTag.toLowerCase())) return r;
      return { ...r, tags: existing.length ? `${existing.join(",")},${csvTag}` : csvTag };
    });

    if (processedRows.length === 0) {
      const msg = parseErrors.length > 0
        ? parseErrors.map((e) => `Row ${e.row}: ${e.message}`).join("; ")
        : "No valid rows found with the given mapping";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const preview = await previewImport(processedRows, auth.context.userId, auth.context.dek ?? undefined);
    if (parseErrors.length > 0) {
      preview.errors.push(...parseErrors.map((e) => ({ rowIndex: e.row - 2, message: e.message })));
    }

    return NextResponse.json({ type: "csv-mapped", headers, totalRows: processedRows.length, ...preview });
  } catch (error: unknown) {
    return NextResponse.json({ error: safeErrorMessage(error, "CSV mapping failed") }, { status: 500 });
  }
}
