export const todayISO = (): string => new Date().toISOString().split("T")[0];

/** Format a Date using its local calendar date, without a UTC day rollover. */
export const formatLocalISODate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
