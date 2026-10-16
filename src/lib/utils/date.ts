export const todayISO = (): string => new Date().toISOString().split("T")[0];

/**
 * "YYYY-MM-DD" for the viewer's LOCAL calendar day. Use in client UI where
 * "today" means the user's wall-clock day (a calendar's today marker, "due in
 * N days"); `todayISO()` is the UTC day, which is already tomorrow for an
 * evening user west of UTC.
 */
export const localDateISO = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
