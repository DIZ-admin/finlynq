/**
 * Custom symbols for the "dollar family" so CAD renders as `C$` and USD as the
 * bare `$`. `Intl.NumberFormat` can only produce `$` / `CA$` / `CAD` for CAD —
 * never `C$` — so the dollar currencies are formatted as plain decimals with a
 * hand-picked symbol prefix. Every other currency keeps its native Intl symbol
 * (EUR → €, GBP → £, JPY → ¥, …).
 */
const DOLLAR_SYMBOLS: Record<string, string> = {
  USD: "$",
  CAD: "C$",
  AUD: "A$",
  NZD: "NZ$",
  HKD: "HK$",
  SGD: "S$",
  MXN: "MX$",
};

export function formatCurrency(
  amount: number,
  currency: string = "USD",
  opts?: { decimals?: number }
): string {
  const decimals = opts?.decimals ?? 2;
  const symbol = DOLLAR_SYMBOLS[currency];
  if (symbol) {
    const num = new Intl.NumberFormat("en-CA", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(Math.abs(amount));
    return `${amount < 0 ? "-" : ""}${symbol}${num}`;
  }
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

export function formatNumber(amount: number): string {
  return new Intl.NumberFormat("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function getMonthLabel(month: string): string {
  const [year, m] = month.split("-");
  const date = new Date(parseInt(year), parseInt(m) - 1);
  return date.toLocaleDateString("en-CA", { year: "numeric", month: "short" });
}
