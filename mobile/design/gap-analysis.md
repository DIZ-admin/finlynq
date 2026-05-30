# Mobile ↔ Web gap analysis

Purpose: map what the **web app** offers vs what the **mobile app** currently has, so we can
decide together: **add to mobile**, **keep web-only**, or **defer**. Then design the mobile menu.

Source of truth for the web surface: [`src/components/nav.tsx`](../../src/components/nav.tsx)
(prod/dev gating verbatim) + the route inventory. Legend:
**✅ have** (already mocked) · **➕ add** (recommend for mobile now) · **🔶 later** (phase 2) ·
**🖥️ web-only** (desktop-heavy / rarely needed on a phone).

---

## A. What mobile has today (9 screens)

Dashboard · Transactions (list) · Transaction Detail · Add Transaction · Import · Budgets ·
Settings · Login · Lock.

That covers **daily capture + review + budgets**. It does **not** cover Wealth (Accounts,
Portfolio), Goals, transfers, or any analysis/planning surface.

---

## B. Page-level comparison (every web nav item)

| Web nav item | Route | prod/dev | On mobile? | Recommendation | Why |
|---|---|---|---|---|---|
| Dashboard | `/dashboard` | prod | ✅ have | keep | daily home |
| Transactions | `/transactions` | prod | ✅ have | keep | core ledger |
| Budgets | `/budgets` | prod | ✅ have | keep | monthly tracking |
| Import | `/import` | prod | ✅ have (lite) | keep lite | mobile = quick file import; full pipeline stays web |
| Settings | `/settings` | prod | ✅ have (subset) | keep subset | only connection/security/appearance on phone |
| **Accounts** (+ `/accounts/[id]`) | `/accounts` | prod | ❌ | **➕ add** | balances + per-account history are daily-glance |
| **Portfolio** | `/portfolio` | prod | ❌ | **➕ add (read)** | holdings + allocation + value; *you flagged this* |
| **Goals** | `/goals` | prod | ❌ | **➕ add** | progress cards are perfect for a phone |
| MCP Guide | `/mcp-guide` | prod | ❌ | 🖥️ web-only | setup/reference doc; link from Settings |
| Reports | `/reports` | prod | ❌ | 🔶 later (lite) | net-worth + spending mini-charts; full Sankey/YoY stays web |
| Admin / Admin Inbox | `/admin*` | prod (admin) | ❌ | 🖥️ web-only | operator tooling |
| AI Chat | `/chat` | dev | ❌ | 🔶 later | conversational → strong phone fit; ship after core |
| Subscriptions | `/subscriptions` | dev | ❌ | 🔶 later | simple list + next-bill |
| Calendar | `/calendar` | dev | ❌ | 🔶 later | bills/income calendar |
| Loans & Debt | `/loans` | dev | ❌ | 🔶 later | status glance ok; amortization charts web |
| Reconcile | `/reconcile` | dev | ❌ | 🖥️ web-only | two-pane N×M; needs width |
| Tax | `/tax` | dev | ❌ | 🖥️ web-only | form-heavy calculators |
| Scenarios | `/scenarios` | dev | ❌ | 🖥️ web-only | planning calculators |
| FIRE Calculator | `/fire` | dev | ❌ | 🖥️ web-only | calculator + Monte Carlo |
| API Docs | `/api-docs` | dev | ❌ | 🖥️ web-only | developer reference |

Also web-only by nature (not in the main nav but real surfaces): **Reconcile/Inbox per-account
modes**, **Settings sub-pages** (rules editor, FX overrides, backup/restore, API keys, dropdown
order, dev mode), **Backfill wizard**, **Portfolio sub-pages** (dividends, realized gains,
new-holding wizard). All 🖥️ web-only — they're configuration or wide-table surfaces.

---

## C. Feature-level gaps *inside* flows we already have

These are the "missing transfers"-type holes — capabilities the web has that the current mobile
screens can't do:

| Capability | Web has it | Mobile today | Recommendation |
|---|---|---|---|
| **Transfers** (account → account, `record_transfer`) | yes (dialog) | ❌ Add screen only does income/expense | **➕ add** — a "Transfer" mode in the Add flow (From/To/amount) |
| **Splits** (split a tx across people/categories) | yes | ❌ | 🔶 later |
| **Edit transaction** (not just view/delete) | yes | partial (Detail → Edit routes to form) | **➕ wire** the Add form to edit mode |
| **Investment ops** (buy/sell/dividend/FX/brokerage) | yes (`/portfolio/new`, ops) | ❌ | 🖥️ web-only for *entry*; mobile Portfolio is **read-only** v1 |
| **Auto-categorize rules** | yes (`/settings/rules`) | ❌ | 🖥️ web-only |
| **Reconcile / approve-each / inbox modes** | yes | ❌ | 🖥️ web-only (maybe a simple "approve" inbox later) |
| **Net-worth trend / spending charts** | yes | ❌ (dashboard shows the number only) | 🔶 later (Reports-lite) |
| **Categories / FX overrides / backup / API keys** | yes (Settings/*) | ❌ | 🖥️ web-only |
| **Multi-currency display toggle** | yes | ❌ | **➕ add** to Settings (cheap, high value) |

---

## D. Proposed mobile information architecture

Constraint: a bottom tab bar holds **max 5 items**; everything else lives in a **"More" sheet**
(mirroring the web's own mobile slide-up panel in `nav.tsx`). Web's *current* mobile bar is
`Home · Txns · Import · Budgets · More` — but that predates Accounts/Portfolio/Goals, so it's
worth reconsidering.

**Three tab-bar options to choose from:**

- **Option A — Money-first + center Add (recommended)**
  `Home · Transactions · ➕ · Budgets · More`
  Center **➕ FAB** opens a quick-add sheet (Expense / Income / **Transfer**). Accounts, Portfolio,
  Goals, Import, Subscriptions, Settings live in **More**. Best for fast daily capture.

- **Option B — Wealth-led**
  `Home · Accounts · Portfolio · Transactions · More`
  Puts net worth front-and-centre; Budgets/Goals/Import/Add in **More**. Best if the app is mainly
  for *watching* money rather than entering it.

- **Option C — Closest to web today**
  `Home · Transactions · Import · Budgets · More`
  Keep the web's existing mobile bar; Accounts/Portfolio/Goals just appear in **More**. Lowest
  change, but buries the new Wealth screens.

**"More" sheet** (all options): grouped list mirroring the web nav groups — Wealth (Accounts,
Portfolio, Goals), Tracking (Subscriptions, Calendar), Tools (Import, Settings), + Sign out +
theme toggle. Same grouping/labels as `navGroups` so web and mobile feel like one product.

**Quick-add FAB (Option A):** one **➕** → sheet with Expense · Income · **Transfer** (and later
Investment). This is where the missing **Transfer** capability lands cleanly.

---

## E. Decisions — RESOLVED ✅ (2026-05-29)

1. **Added to mobile now:** **Accounts (+ detail), Portfolio (read-only), Goals, Transfers (in Add).**
   All four mocked: `accounts.html`, `account-detail.html`, `portfolio.html`, `goals.html`,
   `transfer.html`.
2. **Staying web-only (confirmed):** Reconcile, Tax, Scenarios, FIRE, Rules, Admin, API Docs, deep
   Settings sub-pages, **investment-op entry** (mobile Portfolio is read-only), Backfill, MCP Guide.
3. **Phase 2 (deferred, not blocking):** AI Chat, Subscriptions, Calendar, Loans, Reports-lite.
4. **Mobile menu = Option B (Wealth-led).** Bottom tabs **Home · Accounts · Portfolio · Transactions ·
   More**; everything else in the **More** sheet (`more.html`). No center ➕ FAB — Add/Transfer live
   in More.

**Done:** theme re-skinned to web ✅ · lucide icons ✅ · 6 new screens ✅ · all tab bars rebuilt to
Option B ✅ · `more.html` IA hub ✅ · specs in `screens.md` ✅.

**Open / next:** wire `transfer` From≠To + same-currency guard at build · decide Phase-2 order ·
the RN port (`src/theme/colors.ts` → web tokens, add `lucide-react-native`) when we move from
mockups to code. Lock each screen (🟡→🟢) as you sign off in `screens.md`.
