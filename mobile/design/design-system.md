# Finlynq mobile — design system (mockup contract)

Visual contract for the HTML mockups. **The theme now matches the web app** (the mobile RN
theme was indigo; we re-skinned to the web's amber/teal/coral). Tokens are mirrored as CSS
variables in [`tokens.css`](./tokens.css). Source of truth:

- Colours → [`src/app/globals.css`](../../src/app/globals.css) — OKLCH used **verbatim** in the mockups.
- Icons → **lucide** (same set the web nav uses), via the [`icons.svg`](./icons.svg) sprite.
- Spacing / radius / font scale → [`src/theme/index.ts`](../src/theme/index.ts).

> **RN port action:** the live mobile theme [`src/theme/colors.ts`](../src/theme/colors.ts) still
> holds the old indigo palette. To make the app match these mockups, update `colors.ts` to the
> values below (and add `lucide-react-native`). That's a deliberate, flagged change — not done yet.

## Colour tokens (web-matched)

Aesthetic: **premium fintech dark** — near-black ink, warm **amber** accent, **teal** = positive,
**coral** = negative, hairline rules, always-dark nav chrome.

| token | light (OKLCH) | dark (OKLCH) | hex ≈ | used for |
|---|---|---|---|---|
| `--bg` | `0.985 0.003 85` | `0.115 0.006 245` | `#0b0d10` | page background |
| `--fg` | `0.18 0.015 250` | `0.925 0.003 250` | `#e8eaed` | primary text |
| `--card` | `1 0 0` | `0.155 0.007 245` | `#101317` | card surface |
| `--elevated` | `1 0 0` | `0.185 0.008 245` | `#161a1f` | popover / elevated |
| `--primary` | `0.75 0.165 70` | `0.75 0.165 70` | `#f5a623` | **amber** — CTAs, active, progress |
| `--pos` (chart-2) | `0.72 0.13 170` | `0.75 0.11 170` | teal | income / gains / assets |
| `--neg` (destructive) | `0.62 0.19 28` | `0.63 0.17 28` | `#e5624b` | expense / liability / over / delete |
| `--muted-fg` | `0.52 0.012 250` | `0.66 0.008 245` | `#9aa3ad` | secondary text |
| `--border` | `0.92 0.008 250` | `0.22 0.010 245` | `#1e242b` | hairline rules |
| `--sidebar` (nav chrome) | `0.115 0.006 245` | `0.115 0.006 245` | `#0b0d10` | **always dark** in both themes |

Key web-matched behaviours baked into the mockups:
- **Tab bar is always dark** (web's sidebar is dark in both light + dark) with **amber** active state.
- **Positive = teal, negative = coral** (the old mobile used green/red). Health ring "good" = teal.
- `oklch()` is used directly — render in a modern browser (Chrome/Safari/Edge). For the RN port,
  convert to the hex column above.

## Icons (lucide — same as web)

Sprite: [`icons.svg`](./icons.svg). Use `<svg class="licon"><use href="../icons.svg#i-NAME"/></svg>`;
colour comes from `currentColor`, size from `.licon` (18px; tab bar 22px; `.licon.sm` 16px).
Mapping mirrors `nav.tsx` so web and mobile share iconography:

| use | lucide | sprite id |
|---|---|---|
| Dashboard / Home | LayoutDashboard | `i-home` |
| Transactions / Transfers | ArrowLeftRight | `i-txns` |
| Import | Upload | `i-import` |
| Budgets | PiggyBank | `i-budgets` |
| Settings | Settings | `i-settings` |
| Accounts | Wallet | `i-accounts` |
| Portfolio | TrendingUp | `i-portfolio` |
| Goals | Target | `i-goals` |
| Subscriptions | CreditCard | `i-subscriptions` |
| Loans | Landmark | `i-loans` |
| Reports / file | FileText | `i-file` |
| inflow / outflow | ArrowUpRight / ArrowDownLeft | `i-in` / `i-out` |
| search · back · chevron · plus · more · logout · biometric | Search · ArrowLeft · ChevronRight/Down · Plus · MoreHorizontal · LogOut · ScanFace | `i-search` `i-arrow-left` `i-chevron-*` `i-plus` `i-more` `i-logout` `i-scan-face` |

> Minor inline chevrons on select rows (`▾`) remain unicode — not feature icons. The RN build
> uses `lucide-react-native` (identical glyphs) for everything.

> **Sprite + file:// caveat:** external `<use href>` needs an http origin. View via the local
> server (the launch preview already does); double-clicking the file over `file://` hides icons.

## Scale tokens

- Spacing (`--sp-*`): 4 / 8 / 12 / 16 / 24 / 32.
- Radius (`--r-*`): sm 5 · md 6 · lg 8 · **xl 11 (card)** · 2xl 14 · full. (web base `0.5rem`).
- Font size (`--fs-*`): xs 11 · sm 13 · base 15 · lg 17 · xl 20 · 2xl 24 · 3xl 30. Weights: titles 800.
- Font: Geist (web) — mockups fall back to the system stack; RN ships Geist. Money uses `tabular-nums`.

## Phone-frame conventions

iPhone-14 logical **390 × 844**; CSS bezel + dynamic island + status bar + home indicator. Safe
areas: top 50 / bottom 34. Bottom tab bar = 5 items + a "More" sheet for the rest. Touch targets ≥44px.

## Each screen file

`screens/<name>.html` renders the screen **twice** (`.screen.light` + `.screen.dark`). `index.html`
embeds all via `<iframe>`. Status legend: 🟡 draft · ✏️ revising · 🟢 locked.

See [`gap-analysis.md`](./gap-analysis.md) for web↔mobile coverage and the proposed menu.
