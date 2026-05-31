# Dev worktrees: web + mobile side by side

The web app (`pf-app/`) and the mobile app (`pf-app/mobile/`) live in **one repo**
but are worked on in **two git worktrees** so a half-finished change in one never
gets tangled into a commit for the other. The only code coupling between them is the
type-only contract file [`shared/types.ts`](../shared/types.ts), so keeping them in one
repo means a contract change breaks the mobile side in the same checkout immediately.

## Layout

| Worktree path | Branch | Use it for |
|---|---|---|
| `C:/Users/halaw/Projects/PF/pf-app`    | `dev`        | Web app work (Next.js). Merge to `main` to deploy prod. |
| `C:/Users/halaw/Projects/PF/pf-mobile` | `mobile-dev` | Mobile app work (Expo/RN). `cd pf-mobile/mobile`. |

Each worktree has its own HEAD and staging index, so `git status` in one is never
polluted by edits in the other. You can have both open in two editor windows at once.

> Both worktrees physically contain *all* files (it's a monorepo). The isolation comes
> from having two branches checked out at once — discipline is: do web edits in `pf-app`,
> mobile edits in `pf-mobile`. A dirty mobile tree can no longer block a web commit.

## First-time setup in the mobile worktree

The worktree is a fresh checkout with no `node_modules` (it's gitignored). Once:

```powershell
cd C:/Users/halaw/Projects/PF/pf-mobile/mobile
npm install
```

## Day-to-day

```powershell
# --- web (terminal 1) ---
cd C:/Users/halaw/Projects/PF/pf-app
# ...edit web... then:
git add -A; git commit -m "feat(web): ..."   # commits only land on dev

# --- mobile (terminal 2) ---
cd C:/Users/halaw/Projects/PF/pf-mobile/mobile
npx expo start
# ...edit mobile... then (from the repo root of this worktree):
cd C:/Users/halaw/Projects/PF/pf-mobile
git add -A; git commit -m "feat(mobile): ..."  # commits only land on mobile-dev
```

## Integrating the two branches

Mobile commits live on `mobile-dev`; web commits on `dev`. Because the two sides touch
disjoint file sets (`mobile/**` vs everything else), merges are conflict-free.

```powershell
# fold mobile work into dev (run from the pf-app worktree):
cd C:/Users/halaw/Projects/PF/pf-app
git fetch origin
git merge mobile-dev          # pull mobile commits onto dev
git push origin dev

# keep mobile-dev current with dev (run from the pf-mobile worktree):
cd C:/Users/halaw/Projects/PF/pf-mobile
git merge dev
```

You can also just push `mobile-dev` to GitHub and open a PR into `dev` if you prefer review.

## CI behavior (what triggers what)

| You push... | Web CI/deploy (`ci`, `deploy-dev`, `deploy-prod`) | `mobile-ci` |
|---|---|---|
| only `mobile/**` files  | **skipped** (`paths-ignore: mobile/**`) | runs |
| only web files          | runs | skipped |
| both                    | runs | runs |

- `deploy-dev.yml` / `deploy-prod.yml` no longer redeploy the website for a mobile-only commit.
- `mobile-ci.yml` runs `tsc --noEmit` + `jest` whenever `mobile/**` or `shared/**` changes.
- `docker.yml` is untouched — it's release/tag-driven and mobile never lands there alone.

## EAS builds (local)

The mobile app is **not** the git root, so EAS needs `EAS_NO_VCS=1`. From the mobile worktree:

```powershell
cd C:/Users/halaw/Projects/PF/pf-mobile/mobile

# preview APK (sideloadable):
$env:EAS_NO_VCS=1; eas build -p android --profile preview

# production AAB (Play):
$env:EAS_NO_VCS=1; eas build -p android --profile production

# submit the latest production build to Play internal track:
$env:EAS_NO_VCS=1; eas submit -p android --profile production
```

(On bash/CI the equivalent is `EAS_NO_VCS=1 eas build ...`.)

## Removing / recreating the worktree

```powershell
git -C C:/Users/halaw/Projects/PF/pf-app worktree remove ../pf-mobile
git -C C:/Users/halaw/Projects/PF/pf-app worktree add -b mobile-dev ../pf-mobile dev
```
