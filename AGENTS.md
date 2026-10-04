# Working on the visual review extension

A Manifest V3 Chrome and Firefox extension that shows PostHog visual review results in the sidebar of GitHub pull requests. It's an internal tool for the PostHog team, not a supported product. The [README](README.md) covers install, how it works, and the file layout; read it first.

## Commands

```bash
pnpm install
pnpm typecheck      # tsc, strict
pnpm test           # vitest
pnpm build          # Chrome → dist/, load unpacked in chrome://extensions
pnpm build:firefox  # Firefox → dist-firefox/, load temporarily in about:debugging
pnpm zip:firefox    # → posthog-visual-review-firefox.zip
pnpm dev            # rebuild on change; reload the extension after each edit
pnpm preview        # build the design preview → preview/out/index.html
pnpm screenshots    # PNGs of every sidebar state and the popup → preview/out/screenshots/
```

CI runs typecheck, test, and both browser builds on every push. Run these before you open a PR. There's no formatter or linter, so match the code around you: 4-space indent, single quotes, no semicolons, strict TypeScript.

## Rules that aren't obvious from the code

- **Browser APIs use `extensionBrowser()` from `src/shared/browser.ts`.** It selects Firefox's Promise-based `browser` namespace or Chrome's `chrome` namespace.
- **`src/content/index.ts` runs on every GitHub page.** Keep it tiny. It parses the URL, reads the repo index from storage, imports the sidebar module only for PRs in tracked repos, and imports the code impact module (`impact.js`) on any PR's Files changed page, signed in or not. Don't import React, the hoggies, or anything heavy into it. Pages that aren't PRs must not load either module, make network requests, or wake the service worker.
- **GitHub's DOM is read in two places**: `findPlacement()` (`src/content/index.ts`) for the sidebar, and `src/content/impact/githubDiff.ts` for the Files changed diff. When GitHub changes its markup, those are the places to fix.
- **Code impact classification is evidence-based** (`src/shared/codeImpact.ts`). A file counts as generated only from GitHub's generated metadata, a standard generated file name, or a generated marker in the file's leading comment block. Generated wording elsewhere in a file doesn't count. When counts or headers are missing, the overview says so instead of counting the file as production silently.
- **The sidebar section lives in a shadow root and styles itself with GitHub's Primer CSS variables**, so it follows light, dark, and dimmed themes. Use Primer variables, not hardcoded colors. Its host element carries GitHub's own `discussion-sidebar-item` class for spacing and dividers, and is `hidden` when there's nothing to show.
- **Account state (session, profile, repo index) is only cleared through `clearAccount()`** in `src/background/session.ts`, so the three never disagree. Don't null those storage keys anywhere else.
- **Every surface re-reads state when browser storage changes.** Write state to storage and let the popup and tabs react. Don't message each tab directly.
- **API calls use `credentials: 'omit'`.** Some PostHog endpoints prefer session cookies over the bearer token, so a request that sends cookies can act as the wrong user.
- **`src/shared/runState.ts` mirrors `REVIEW_STATE_FILTERS` in the PostHog backend** (`products/visual_review/backend/logic/run_queries.py`). If you change how a run maps to a state, check the backend still agrees.
- **The manifest `key` pins the extension ID**, and with it the OAuth redirect `https://coegljbgaffjilmoampifafjigkdmjaf.chromiumapp.org/` that the client metadata document registers (PostHog/posthog.com, `static/.well-known/oauth/visual-review/client-metadata.json`). Changing the key breaks sign-in until the document changes too. The private key is in 1Password as **Visual Review extension signing key**; never commit it.
- **Firefox OAuth setup.** The stable Gecko ID fixes its callback. The default hosted client registers only Chrome; Firefox builds need an explicitly registered public `POSTHOG_OAUTH_CLIENT_ID`. The signed-out auth state reports this prerequisite before the popup requests host access. See [Firefox developer setup](README.md#firefox-developer-setup).
- **OAuth scopes are listed twice**: in `src/background/auth.ts` and in the client metadata document, which caps them. A new scope goes in both, or sign-in fails with `invalid_scope`.
- **Manifest permissions are user-facing.** A new permission or host permission shows up in Chrome's install prompt. Add one only when nothing else works, and say why in the PR.
- **GitHub Actions are pinned to commit SHAs**, as the PostHog org requires. Keep the version in a trailing comment.

## Tests

Tests sit next to the code as `*.test.ts`. Pure logic (URL parsing, run state, the repo index) lives in `src/shared/` so it can be tested without Chrome APIs. Put new logic there when you can, and test what a change could break rather than padding coverage.

## UI changes

The design preview (`preview/preview.tsx`) renders every sidebar state and both popup states from mock data, with no extension or sign-in needed.

- A new sidebar state or popup view gets an entry in the preview.

## Commits and PRs

- Conventional commits with a scope when one fits: `feat(content): …`, `fix(auth): …`, `ci: …`, `docs: …`. Say what changed for the person using the extension.
- You must follow the [PR template](.github/pull_request_template.md) when opening a PR.
- Releases are cut from version tags. See [Release](README.md#release) in the README.
