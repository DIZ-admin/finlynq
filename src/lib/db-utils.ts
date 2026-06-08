// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeDbRows<T = Record<string, unknown>>(result: any): T[] {
  if (result && typeof result === "object") {
    if ("rows" in result && Array.isArray(result.rows)) return result.rows as T[];
    if (Array.isArray(result)) return result as T[];
  }
  return [];
}
