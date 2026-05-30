# Sample dataset (shared across all mockups)

One fictional user, used so every screen shows **internally consistent** numbers.
All amounts CAD, formatted `Intl.NumberFormat("en-CA", { style:"currency", currency:"CAD" })`.
Summary tiles (net worth, income/expenses, budgets) render at **0 decimals** (matches the
current `DashboardScreen`/`BudgetsScreen` `formatCurrency`); individual transaction amounts
render at **2 decimals** (matches `TransactionsScreen`).

## User / session
- username: `alex` · email: `alex@example.com` · displayName: `Alex`
- displayCurrency: `CAD`
- server URL: `https://dev.finlynq.com`

## Dashboard (`DashboardData` + `HealthScoreData`)
- netWorth: **$148,250** · totalAssets: **$172,400** · totalLiabilities: **$24,150**
- monthlyIncome: **$6,200** · monthlyExpenses: **$4,180** · savingsRate: **33%**
- health score: **78** · grade: **Good** (≥70 → green `#10b981`)

## Accounts (`Account[]`)
| name | type | group | currency | balance |
|---|---|---|---|---|
| TD Chequing | A | Cash | CAD | $4,820 |
| EQ Savings | A | Cash | CAD | $18,300 |
| Questrade TFSA | A | Investments | CAD | $61,540 |
| Amex Cobalt | L | Credit | CAD | −$1,650 |
| Car Loan | L | Debt | CAD | −$22,500 |

## Recent transactions (`Transaction[]`, newest first)
| date | payee | category | account | amount |
|---|---|---|---|---|
| 2026-05-28 | Loblaws | Groceries | TD Chequing | −$84.32 |
| 2026-05-27 | Acme Payroll | Salary | TD Chequing | +$3,100.00 |
| 2026-05-27 | Tim Hortons | Dining | Amex Cobalt | −$6.45 |
| 2026-05-26 | Hydro One | Utilities | TD Chequing | −$112.00 |
| 2026-05-25 | Amazon | Shopping | Amex Cobalt | −$43.19 |
| 2026-05-24 | Petro-Canada | Transport | Amex Cobalt | −$58.70 |

Detail screen focuses on **Loblaws · −$84.32 · 2026-05-28 · TD Chequing · Groceries · tags: weekly, essentials**.

## Budgets — May 2026 (`BudgetWithSpending[]`)
Totals: spent **$1,390** of **$1,590** → **$200 remaining**.
| category | group | spent | budget | state |
|---|---|---|---|---|
| Groceries | Food | $520 | $600 | under |
| Dining | Food | $310 | $250 | **over $60** |
| Transport | Auto | $140 | $200 | under |
| Shopping | Lifestyle | $180 | $300 | under |
| Utilities | Home | $240 | $240 | at limit |

Add-budget chips (unbudgeted expense categories): Entertainment · Health · Subscriptions · Travel.

## Import preview (CSV)
File: `td-chequing-may.csv` · 3 columns mapped (Date, Description, Amount) · 42 rows · 3 flagged duplicates.
Preview rows: `2026-05-28 Loblaws −84.32` · `2026-05-27 Payroll +3,100.00` · `2026-05-26 Hydro One −112.00`.

## Add transaction (prefilled draft)
date `2026-05-29` · amount `42.50` · account `TD Chequing` · category `Dining` · payee `Café Local` · tags `coffee`.
