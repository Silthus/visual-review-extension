# PostHog Visual Review for GitHub

> **Internal tool for the PostHog team.** It isn't a supported PostHog product. The code is public, but it's built around how we use visual review ourselves.

A Chrome extension, with a Firefox developer build, that shows [visual review](https://github.com/PostHog/posthog/tree/master/products/visual_review) results in the sidebar of GitHub pull requests, so nobody has to scroll to the checks at the bottom of the page.

- **On GitHub:** a "Visual review" section in the PR's sidebar, right after Labels. It uses GitHub's own Primer variables, so it follows light, dark, and dimmed themes. It shows:
  - the overall state (needs review, approved, no changes, in progress, failed)
  - one row per run type (storybook, playwright, …), each linking to its run in PostHog
  
  It only shows up when there's something to report, and only on the Conversation tab, where GitHub shows the sidebar.
- **Popup (toolbar icon):** the only place to sign in. It also shows the current tab's status, the repos being watched, and a default project picker, styled like the PostHog app (RoundHog, LemonButton, hoggies from `@posthog/brand`).

## Install

1. Download [`posthog-visual-review.zip`](https://github.com/PostHog/visual-review-extension/releases/latest/download/posthog-visual-review.zip) from the latest release.
2. Unzip it somewhere it can stay, for example `~/Applications/posthog-visual-review`. Chrome loads the extension from that folder.
3. Open `chrome://extensions` and turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the unzipped folder.
5. Pin the extension, click its icon, and choose **Sign in with PostHog**.

**To update:** download the new zip, unzip it over the same folder, and click the reload icon on the extension's card in `chrome://extensions`. Reloading keeps your sign-in. Removing the extension clears it.

## Firefox developer setup

Firefox uses the same extension code with a browser-specific manifest. Build and load it temporarily:

```bash
pnpm build:firefox      # → dist-firefox/
pnpm zip:firefox        # → posthog-visual-review-firefox.zip
pnpm dev:firefox        # rebuild on change
```

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dist-firefox/manifest.json`. Firefox 128 or newer is required. Temporary add-ons disappear when Firefox restarts; installing permanently requires Mozilla signing, which these commands do not perform.

**Sign-in requires Firefox OAuth registration.** The hosted client metadata currently registers only the Chrome callback. The default Firefox build loads, and the signed-out popup shows the actual Firefox callback and disables sign-in until you configure a client. The stable Gecko ID is `visual-review@posthog.com`; do not change it after registering a client.

For a developer build, register a public authorization-code client on the PostHog host you will use. Use the callback printed by the extension, PKCE with `S256`, token endpoint authentication `none`, and these scopes: `visual_review:read user:read project:read organization:read`. An instance administrator can register that client, or instances that support dynamic registration accept:

```bash
curl --fail-with-body https://oauth.posthog.com/oauth/register/ \
    -H 'Content-Type: application/json' \
    --data '{"client_name":"Visual Review for Firefox","redirect_uris":["<callback shown by the extension>"],"grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"none","scope":"visual_review:read user:read project:read organization:read"}'
```

For self-hosted or local development, replace `https://oauth.posthog.com` with your instance URL. Use the returned public `client_id`, never a client secret, and rebuild:

```bash
POSTHOG_OAUTH_CLIENT_ID='<registered public client_id>' pnpm build:firefox
# Or use the same environment variable with pnpm zip:firefox / pnpm dev:firefox.
```

Chrome builds always use the hosted first-party client.

Reload the temporary add-on and select the same PostHog host in the popup. Registration belongs to that host; a client registered on a self-hosted instance cannot sign in through Cloud. The Cloud registration proxy registers the client in both Cloud regions.

PostHog reserves client names that start with its brand, so the developer registration uses "Visual Review for Firefox".

A shared first-party Firefox client still requires a hosted metadata document that registers Firefox's callback. Once available, its HTTPS URL can be supplied as `POSTHOG_OAUTH_CLIENT_ID`. This extension does not register anonymous clients automatically or send Firefox sign-in through Chrome's callback.

## How it works

```
GitHub page ──(content.js, 3 KB)── repo index in chrome.storage ──▶ not a tracked PR: nothing, no request
                    │
                    ├── tracked PR ──▶ sidebar.js ─▶ service worker ──(OAuth bearer)──▶ PostHog API
                    │
                    └── any PR's Files changed ──▶ impact.js (reads the diff on the page, no request, no sign-in)
```

- **Auth.** OAuth 2.0 authorization code + PKCE, run through the shared browser adapter and the browser's `identity.launchWebAuthFlow`.
  - PostHog Cloud goes through `oauth.posthog.com`, which works out whether the user is on US or EU and returns `posthog_base_url` with the token.
  - Self-hosted and local instances are called directly.
  - The `client_id` is the URL of a [client ID metadata document](https://posthog.com/.well-known/oauth/visual-review/client-metadata.json) (CIMD) that lives in [PostHog/posthog.com](https://github.com/PostHog/posthog.com) at `static/.well-known/oauth/visual-review/client-metadata.json`. Each PostHog instance fetches it, so **Chrome needs no client registration in PostHog**, and it's the same client on US, EU, and self-hosted. A self-hosted instance needs outbound HTTPS to posthog.com.
  - The document registers one redirect, `https://coegljbgaffjilmoampifafjigkdmjaf.chromiumapp.org/`. The `key` in `src/manifest.json` pins that extension ID wherever the folder lives, so don't change the key without updating the document.
  - `key` is the public half. The private half is in 1Password as **Visual Review extension signing key**. Loading unpacked never needs it; it's only for signing a `.crx` or a first Chrome Web Store upload that keeps the same ID. Never commit it.
  - Scopes: `visual_review:read user:read project:read organization:read`. The document caps the client at the same list, so a new scope goes in both.
- **Repo index.** The worker lists visual review repos in every project the token can reach and saves `owner/repo` → project + repo id to `chrome.storage.local`.
  - It is rebuilt on sign-in, when the default project changes, and from the popup's Refresh button.
  - A visit to an unknown repo rebuilds it at most hourly, so newly enabled repos show up. After a failure it backs off for 5 minutes.
  - The default project wins when a repo is set up in more than one project.
- **Loader + sidebar.** `content.js` runs on every GitHub page but only parses the URL and reads the index. For a PR in a tracked repo it imports `sidebar.js` (React and the hoggies). Everything else costs no network request and never wakes the worker.
- **Code impact.** On any PR's Files changed page, `impact.js` labels each file Production, Test, or Generated and adds a Change impact overview above the diff with added and deleted lines per category. The Generated lines control shows, dims, or hides generated diff lines; review comments stay visible, and the choice is shared across tabs through storage.
  - Generated: GitHub's generated-file metadata (`linguist-generated`), standard generated names such as lockfiles (including `bun.lock`), `*.min.js`, `*.pb.go`, `*_pb2.py`, `__generated__/`, `*.generated.*`, or an `@generated`, `Code generated … DO NOT EDIT`, `This file was automatically generated`, or `Auto-generated by …` marker in the file's leading comment block (its first 40 lines; Markdown reads only HTML comments, and `--` comments count only in SQL, Lua, and Haskell). The marker must be in a comment; the same words in code or later comments don't count. Nothing guesses whether code was written by AI.
  - Test: `*.test.*` and `*.spec.*` JavaScript and TypeScript files, `__tests__/`, `__snapshots__/`, `test/` and `tests/` directories, `test_*.py`, `*_test.py`, `tests.py`, and `conftest.py`.
  - Classification is per file. A file's lines all count toward its category; generated regions inside hand-written files aren't split out.
  - The overview says when its counts are incomplete: files GitHub hasn't loaded yet, and files without line counts. A muted note also lists files whose leading comment block isn't fully in the diff, so it couldn't be checked for a generated marker.
- **Runs.** The newest non-superseded run is kept for each run type. While a run is processing, the section refreshes every 15s; a tracked PR with no runs yet is checked every minute. It also refreshes when you come back to the tab.
- **Account state.** `background/session.ts` is the only place that clears the session, profile, and index. Every surface re-reads state when `chrome.storage` changes, so signing in or out updates open tabs straight away.

## Develop

```bash
pnpm install
pnpm build        # Chrome → dist/
pnpm build:chrome # explicit Chrome build
pnpm build:firefox # Firefox → dist-firefox/
pnpm dev          # rebuild on change, then reload the extension in chrome://extensions
pnpm test         # vitest
pnpm typecheck
```

Load `dist/` with **Load unpacked**, as in [Install](#install).

To use a local PostHog, open the popup, choose **Self-hosted / local**, and enter something like `http://localhost:8010`. Chrome asks for permission to reach that host.

**Design preview.** Every sidebar state and the popup render with mock data, no extension or sign-in needed:

```bash
pnpm preview && open "preview/out/index.html?theme=dark"   # or ?theme=light, ?popup=signedIn, ?popup=signedOut, ?popup=firefoxNeedsClient
pnpm screenshots                                          # PNGs of all of them → preview/out/screenshots/ (needs Chrome)
```

See [AGENTS.md](AGENTS.md) for how to work in this repo.

**Icons** come from the brand logomark: run `node scripts/icons.mjs` (needs `rsvg-convert`).

## Release

1. Bump `version` in `src/manifest.json` and `package.json`.
2. Merge to `main`.
3. Tag and push:

   ```bash
   git tag v0.2.0 && git push origin v0.2.0
   ```

The [release workflow](.github/workflows/release.yml) checks that the tag matches the manifest version, runs the checks, and attaches `posthog-visual-review.zip` to a GitHub release. The download link in [Install](#install) always points at the newest one.

## Layout

| Path                              | What                                                                     |
| --------------------------------- | ------------------------------------------------------------------------ |
| `src/background/auth.ts`          | PKCE, token exchange, refresh, revoke                                    |
| `src/background/session.ts`       | Account state (the only place it's cleared) and the authenticated `api()` |
| `src/background/repoIndex.ts`     | Builds the tracked-repo index across projects                            |
| `src/background/visualReview.ts`  | Runs for a PR in a tracked repo                                          |
| `src/content/index.ts`            | Loader: URL + index check, placement in GitHub's PR sidebar              |
| `src/content/mount.tsx`, `App.tsx`, `Sidebar.tsx` | The sidebar section, rendered in a shadow root           |
| `src/content/impact/`             | Code impact on Files changed: diff reader, overview, file badges         |
| `src/shared/codeImpact.ts`        | Generated, test, and production rules and the per-category totals        |
| `src/popup/`                      | Popup UI                                                                 |
| `src/shared/browser.ts`          | Shared access to native Firefox `browser` APIs and Chrome `chrome` APIs   |
| `src/shared/runState.ts`          | Run → state rules, mirroring `REVIEW_STATE_FILTERS` in the backend       |
| `src/shared/runCopy.ts`           | Label, tone, and hoggie for each state                                   |

## Known limitations

- **GitHub DOM.** The section mounts in `#partial-discussion-sidebar`, right after the Labels section (found by its `labels_updated` channel, or `.js-issue-labels`). If GitHub changes that markup, `findPlacement()` in `src/content/index.ts` is the only place to fix.
- **Conversation tab only.** GitHub only shows the sidebar there, so Commits, Checks, and Files changed show no visual review results.
- **Code impact reads GitHub's classic Files changed markup** (`.file[data-tagsearch-path]` entries inside `#files`) in `src/content/impact/githubDiff.ts`. It loads only on `/pull/N/files`; GitHub's newer React view isn't supported, and on other markup it finds no files and stays hidden.
- **Reading only.** The extension doesn't approve or tolerate snapshots.
- **Firefox sign-in.** The default hosted OAuth client registers only Chrome. Firefox developer builds need a separately registered public client as described above.
