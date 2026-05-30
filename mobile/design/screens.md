# Mobile screen specs

Per-screen build reference. Status legend: 🟡 draft (awaiting review) · ✏️ revising · 🟢 locked (approved).
Mockups live in `screens/<name>.html`; gallery is `index.html`. Tokens: `design-system.md`.

**Menu (IA) = Option B — Wealth-led.** Bottom tabs: **Home · Accounts · Portfolio · Transactions · More**.
Everything else (Add, Transfer, Budgets, Goals, Import, Settings, …) lives in the **More** sheet.

| # | Screen | File | Status | Tab |
|---|---|---|---|---|
| 1 | Dashboard | `screens/dashboard.html` | 🟡 draft | Home |
| 2 | Accounts | `screens/accounts.html` | 🟢 new | Accounts |
| 3 | Account Detail | `screens/account-detail.html` | 🟢 new | (push) |
| 4 | Portfolio (read-only) | `screens/portfolio.html` | 🟢 new | Portfolio |
| 5 | Transactions | `screens/transactions.html` | 🟡 draft | Txns |
| 6 | Transaction Detail | `screens/transaction-detail.html` | 🟡 draft | (push) |
| 7 | Add Transaction | `screens/add-transaction.html` | 🟡 draft | (modal) |
| 8 | Transfer | `screens/transfer.html` | 🟢 new | (modal) |
| 9 | Budgets | `screens/budgets.html` | 🟡 draft | More |
| 10 | Goals | `screens/goals.html` | 🟢 new | More |
| 11 | Import | `screens/import.html` | 🟡 draft | More |
| 12 | Settings | `screens/settings.html` | 🟡 draft | More |
| 13 | More menu | `screens/more.html` | 🟢 new | Tab 5 |
| 14 | Login / Register | `screens/login.html` | 🟡 draft | — |
| 15 | Lock | `screens/lock.html` | 🟡 draft | — |

---

## 1 · Dashboard — 🟡 draft

- **Purpose:** at-a-glance financial overview; the app's home tab.
- **RN counterpart:** [`src/screens/DashboardScreen.tsx`](../src/screens/DashboardScreen.tsx). Web counterpart: `/dashboard`.
- **Data / API:**
  - `endpoints.getDashboard()` → `DashboardData` (netWorth, totalAssets, totalLiabilities, monthlyIncome, monthlyExpenses, savingsRate, recentTransactions[]).
  - `endpoints.getHealthScore()` → `HealthScoreData` (score, grade, components[]).
  - `endpoints.getBudgets(currentMonth)` → `BudgetWithSpending[]` (top 5 shown).
  - All three fetched in parallel; pull-to-refresh re-runs them.
- **Layout (top→bottom):**
  1. Large title "Dashboard".
  2. Hero row: **Net Worth** card (value + Assets `--pos` / Liabilities `--neg` split) beside a fixed-width **Health** card (conic-gradient ring, score + grade).
  3. **This Month** card: Income `--pos` / Expenses `--neg`, plus savings-rate bar + caption.
  4. **Budget Progress** card: up to 5 category rows (name · spent/budget · bar); over-budget bar uses `--destructive` (Dining in the sample).
  5. **Recent Transactions** card: up to 5 rows (direction indicator · payee · date · signed amount; inflow amount `--pos`).
- **States:** loading (spinner) · error (destructive message) · empty (per-card "No …" copy) · populated (shown).
- **Formatting:** summary tiles 0-decimal `en-CA` currency (matches current screen); transaction amounts 2-decimal.
- **Health colour scale (not a theme token):** ≥70 `#10b981`, ≥40 `#f59e0b`, <40 `#ef4444`.
- **Improvements proposed in this draft (vs current RN):**
  - Health ring is a clean conic-gradient donut (current RN approximates an arc with coloured borders → uneven).
  - Recent-transaction amounts show cents (current dashboard renders 0-decimal, dropping cents).
  - Tab-bar/touch targets sized ≥44px; tab glyphs are placeholders pending a real icon set.
- **Open questions for review:** card density/spacing OK? Keep Health card in the hero row or give it its own full-width card? Keep summary tiles at 0 decimals?

---

## 2 · Transactions — 🟡 draft

- **Purpose:** the full ledger; search, scan, drill into a transaction, add a new one.
- **RN counterpart:** [`src/screens/TransactionsScreen.tsx`](../src/screens/TransactionsScreen.tsx) (in `TransactionsStack`). Web: `/transactions`.
- **Data / API:** `endpoints.getTransactions("limit=50&order=desc&search=…")` → `Transaction[]`; `endpoints.deleteTransaction(id)` on delete. Refetches on focus + on search submit + pull-to-refresh.
- **Layout:** title + "+ Add" (→ Add modal) · search bar · hint line · `FlatList` of rows = circular direction indicator (`↑` inflow `--pos` / `↓` outflow) + payee + date·category sub + signed amount (`--pos` for inflow) + chevron.
- **Interactions:** tap row → Transaction Detail; long-press → Edit / Delete action sheet.
- **States:** loading · error · empty ("No transactions yet") · no-match ("No matching transactions").
- **Improvement vs current:** sub-line shows `date · category` (current RN shows date only); amounts already 2-decimal.

## 3 · Transaction Detail — 🟡 draft

- **Purpose:** full record of one transaction with edit/delete.
- **RN counterpart:** `src/screens/TransactionDetailScreen.tsx` (stack push from Transactions).
- **Data:** receives the `Transaction` via nav param; Edit routes to Add/edit form, Delete calls `deleteTransaction(id)`.
- **Layout:** back nav bar ("‹ Transactions" · Edit) · centred amount hero (direction indicator + signed amount + payee + date) · detail card of key/value rows (Account, Category, Currency, Tags as chips, Note) · Edit (primary) + Delete (destructive) buttons. Bottom tab bar stays visible (stack lives inside the Transactions tab).
- **States:** populated (shown). Tags/Note rows hide when empty.

## 4 · Add Transaction — 🟡 draft

- **Purpose:** create (or edit) a transaction.
- **RN counterpart:** `src/screens/AddTransactionScreen.tsx` (modal presentation).
- **Data:** builds `TransactionFormData` (date, amount, accountId, categoryId, payee, note, tags) → `endpoints.createTransaction(...)`. Account/category options from `endpoints.getAccounts()` / `getCategories()`.
- **Layout:** modal bar (Cancel · title · Save) · Income/Expense segmented chips · large Amount field · Date / Account / Category select rows (open native pickers) · Payee · Tags · Note textarea · full-width Save. No tab bar (modal covers it).
- **States:** prefilled draft shown; inline validation on amount/category in the real screen.

## 5 · Import — 🟡 draft

- **Purpose:** upload a statement file, preview parsed rows + duplicate flags, confirm.
- **RN counterpart:** `src/screens/ImportScreen.tsx` (uses `expo-document-picker`). Web: `/import`.
- **Data:** picks CSV/OFX/QFX → uploads to the staging endpoint → preview payload (rows, mapped columns, duplicate matches) → confirm import.
- **Layout (preview state shown):** title · chosen-file card (icon, name, size, Change) · column-mapping card (Date/Description/Amount/Account key-values) · preview card (duplicate count badge + a few rows with per-row `dup` badge + "+ N more") · primary "Import N new rows".
- **States:** initial (choose file) · parsing · preview (shown) · importing · result. Mockup shows the preview/decision state.

## 6 · Budgets — 🟡 draft

- **Purpose:** set monthly per-category budgets and track spend.
- **RN counterpart:** [`src/screens/BudgetsScreen.tsx`](../src/screens/BudgetsScreen.tsx). Web: `/budgets`.
- **Data:** `endpoints.getBudgets(month)` → `BudgetWithSpending[]`; `endpoints.getCategories()` for the add-form chips; `POST /api/budgets` to add/edit, `DELETE /api/budgets?id=` to remove.
- **Layout:** title + "+ Add" · month navigator (← Prev · Month Year · Next →) · overall summary card (Spent vs Budgeted, bar, remaining) · per-category cards (name · group · spent "of" budget · bar · remaining; over-budget → `--destructive` bar + "$X over budget"). Add-budget form (collapsed here) = category chip row + amount field + Add.
- **Interactions:** long-press a card → Edit amount / Delete.
- **States:** loading · error · empty ("No budgets set for <month>") · populated (shown).

## 7 · Settings — 🟡 draft

- **Purpose:** connection, security, appearance, account, sign out.
- **RN counterpart:** [`src/screens/SettingsScreen.tsx`](../src/screens/SettingsScreen.tsx).
- **Data:** identity from `getSession()` (`SessionInfo`: username/email/displayCurrency); server URL via `getServerUrl()`/`setServerUrl()`; biometric + auto-lock from `useAuth` (`expo-secure-store` + `expo-local-authentication`); theme from device color scheme.
- **Layout:** grouped cards — **Account** (name/email + currency badge) · **Security** (Biometric toggle, Auto-lock timeout 0/1/5/15/30) · **Connection** (Server URL + Edit) · **Appearance** (Theme System/Light/Dark) · Sign-out (destructive) · version footer.
- **States:** toggles reflect stored prefs; auto-lock row only meaningful when biometric is available.

## 8 · Login / Register — 🟡 draft

- **Purpose:** authenticate; create an account.
- **RN counterpart:** `src/screens/LoginScreen.tsx`. Single identity source: `GET /api/auth/session`.
- **Data:** `endpoints.login(identifier, password)` (`identifier` = username OR email); `endpoints.register(RegisterPayload)` (username required, email optional → `acknowledgeNoRecovery` when omitted). Server URL field gates which backend (`setServerUrl`).
- **Layout (sign-in state shown):** brand block (mark + name + tagline) · Username-or-email field · Password field · Sign in (primary) · "Create an account" toggle to register · server URL select pinned at the bottom. No tab bar.
- **Register variant (described, not separately mocked):** adds Username, Email (optional), Password, optional Display name, and a "no recovery without email" acknowledgement.
- **States:** idle · submitting (spinner in button) · error (inline message under the form).

## 9 · Lock — 🟡 draft

- **Purpose:** re-authenticate with biometrics after auto-lock without dropping the session.
- **RN counterpart:** `src/screens/LockScreen.tsx`. Shown by `RootNavigator` when `!isUnlocked && hasSession && biometricAvailable`.
- **Data:** `expo-local-authentication` prompt; success → unlock; "Use password instead" → sign-out/login path.
- **Layout:** brand · large biometric icon · "Unlock Finlynq" + "Use Face ID to continue" · primary "Unlock with Face ID" · ghost "Use password instead" · "Signed in as <user>" footer. No tab bar.
- **States:** waiting for prompt · failed attempt (retry copy) · fallback to password.

---

## 2 · Accounts — 🟢 new

- **Purpose:** net worth + every account's balance, grouped by type; entry to per-account detail. Tab 2.
- **Web counterpart:** `/accounts`. **API:** `endpoints.getAccounts()` → `Account[]` (group by `group`; `type` A/L drives positive/negative colour).
- **Layout:** title · Net Worth card (Assets `--pos` / Liabilities `--neg`) · grouped sections (Cash, Investments, Credit & Debt) of rows = type icon + name + currency + balance + chevron → detail. Liabilities render `--neg`.
- **States:** loading · empty ("No accounts yet") · populated.

## 3 · Account Detail — 🟢 new

- **Purpose:** one account's balance + its recent activity. Pushed from Accounts.
- **Web counterpart:** `/accounts/[id]`. **API:** account record + `getTransactions("account=<id>")`.
- **Layout:** back nav · balance hero (account icon + balance + group · currency) · "Recent activity" list · "View all transactions". Edit in nav for rename/mode.
- **Note:** cash-sleeve management + reconciliation mode stay web-only.

## 4 · Portfolio (read-only) — 🟢 new

- **Purpose:** holdings, allocation, total value & unrealized gain. **Read-only v1** — buy/sell/dividends stay on web. Tab 3.
- **Web counterpart:** `/portfolio`. **API:** portfolio overview (value, gain, holdings[], allocation%).
- **Layout:** title · Total Value card (value + gain `--pos`/`--neg` + multi-segment allocation bar using `--chart1..5`) · Holdings list (symbol · name · value · gain%) · "manage on web" hint.
- **States:** loading · empty ("No holdings") · populated. No write actions.

## 7 · Add Transaction (+ Transfer) — 🟡 draft / 🟢 transfer

- **Update:** the segmented control is now **Income · Expense · Transfer**. Transfer mode is mocked separately (`transfer.html`).

## 8 · Transfer — 🟢 new

- **Purpose:** move money between two accounts. The "Transfer" mode of the Add flow — the main capability gap vs web.
- **Web counterpart:** transfer dialog / `record_transfer`. **API:** `record_transfer` (From account, To account, amount, date).
- **Layout:** modal bar (Cancel/Save) · segmented (Transfer active) · Amount · **From** select · ⇄ · **To** select · Date · Note · Save. Hint: "Creates a linked pair (out of From, in to To)" — mirrors the server-generated `link_id` pair.
- **Guard (build):** From ≠ To; same-currency only (cross-currency FX stays web), surfaced inline.

## 10 · Goals — 🟢 new

- **Purpose:** track savings / debt-payoff / emergency-fund goals. Reached via More.
- **Web counterpart:** `/goals`. **API:** `getGoals()` → `Goal[]` (name, type, targetAmount, current, deadline).
- **Layout:** title + Add · goal cards (name · % badge · saved "of" target · progress bar · deadline + monthly-needed). Debt-payoff phrased as "paid".
- **States:** loading · empty ("No goals yet") · populated.

## 13 · More menu — 🟢 new

- **Purpose:** the IA hub — Add/Transfer + every screen outside the 5 tabs. The native equivalent of the web's mobile slide-up panel in `nav.tsx`.
- **Layout:** slide-up sheet over a scrim · grabber · "More" + theme control · grouped rows (Add: Add transaction, Transfer · Tracking: Budgets, Goals, Subscriptions · Tools: Import, Reports, Settings) · Sign out (`--neg`). Groups/labels mirror web `navGroups` so the two products feel unified.
- **Behaviour:** tapping the **More** tab opens this; tapping a row pushes that screen; tap scrim / grabber to dismiss.

## Cross-cutting notes (apply to all screens)

- **Theme matches the web** (amber primary, teal positive, coral negative, always-dark nav) via `tokens.css` ← `globals.css`. RN port must update `src/theme/colors.ts` to these values. See `design-system.md`.
- **Icons are lucide** (same set as the web nav) via `icons.svg`. RN build uses `lucide-react-native`. Minor select-row chevrons remain unicode.
- **Coverage gap + proposed menu**: see [`gap-analysis.md`](./gap-analysis.md). New screens (Accounts, Portfolio, Goals, Transfers) are pending the add/web-only/menu decisions.
- **Touch targets ≥ 44px** throughout (current RN buttons are 32px `h-8`); reflected in `.btn`.
- **Light + dark** are the same markup driven by `tokens.css` vars — keep parity when revising.
- **Decrypted-name null-safety:** real screens must guard account/category/payee names per the app's `safeName`/`safeAccountName` invariant (cold-DEK). Mockups use static names.
