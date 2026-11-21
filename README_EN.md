<div align="center">
  <img src="assets/logo.svg" width="72" height="72" alt="Agy Powertools Logo" />
  <h1>Agy Powertools</h1>
  <p><strong>Native UI enhancement plugin for Antigravity 2.0</strong></p>
  <!-- plugin-badges:start -->
  <p>
    <a href="https://github.com/WhiteBr1ck/agy-powertools/releases"><img src="https://img.shields.io/github/v/release/WhiteBr1ck/agy-powertools?label=Release&color=2563eb" height="20" alt="Release" /></a>
    <a href="https://github.com/WhiteBr1ck/agy-powertools/actions/workflows/ci.yml"><img src="https://github.com/WhiteBr1ck/agy-powertools/actions/workflows/ci.yml/badge.svg" height="20" alt="CI" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-16a34a" height="20" alt="MIT License" /></a>
    <img src="https://img.shields.io/badge/Antigravity-2.34.0-0f172a" height="20" alt="Antigravity 2.34.0" />
    <img src="https://img.shields.io/badge/Node.js-%3E%3D22.13-339933" height="20" alt="Node.js >= 22.13" />
    <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-475569" height="20" alt="Platform" />
  </p>
  <!-- plugin-badges:end -->
  <p>
    <a href="README.md">简体中文</a> |
    <strong>English</strong>
  </p>
  <p>
    <a href="#features">Features</a> |
    <a href="#installation-and-uninstallation">Installation</a> |
    <a href="#key-features-in-detail">Key features</a> |
    <a href="#screenshots">Screenshots</a> |
    <a href="#configuration-reference">Configuration</a> |
    <a href="#changelog">Changelog</a>
  </p>
</div>

> [!NOTE]
> This is a fork of [WhiteBr1ck/agy-powertools](https://github.com/WhiteBr1ck/agy-powertools). On top of upstream `main` it adds a reasoning-effort switcher, Markdown conversation export, and a bottom status bar (context usage, used/max tokens, cache hit rate, speed), and it follows upstream updates.
> The instructions below install this repository's `main` branch. Upstream Release packages and in-app updates do not include these changes.

![Agy Powertools interface overview](docs/images/app-compact.png)

## What it does

**Agy Powertools** is a native UI enhancement plugin for Antigravity 2.0. It attaches directly to the desktop client over the local debugging interface and reads local SQLite and JSONL session records in read-only mode. It does not patch client binaries or open external web dashboards; every control renders inside the native Antigravity interface.

It addresses four common friction points in daily Antigravity usage:

1. **Low reading density and missing localization**: Default chat line height and block spacing leave too little code and tool output on screen, and built-in menus lack Simplified Chinese localization.
2. **Opaque or noisy multi-step execution**: During long tool runs, the agent either stays silent for minutes or leaves intermediate commentary scattered across the main reply.
3. **No live context window or quota visibility**: Long sessions lack a live view of context usage, cache hit rate, token speed, error details, and 5-hour or weekly quota consumption.
4. **Awkward branching and prompt editing**: Retrying a previous prompt with edits or branching a new chat from a specific historical reply takes extra manual steps.

## Features

- **Codex-like conversation flow**: Same-font compact layout, plus live stage updates while tools run that automatically fold into the top duration bar once the turn completes.
- **Context ring and dynamic speed gauge**: Separate composer controls for context usage (including cache reuse, compaction count, and Orchestrator per-model context bars) and live generation speed (`tok/s`, TTFT, and model vs. tool timing).
- **Lossless session branching and message editing**: Fork a new chat from any historical reply with full prior steps and tool records preserved, or open the native composer in place to edit a sent message and regenerate.
- **Task progress, persistent outline, and taskbar unread reminders**: Track checklist completion, recent tool activity, and elapsed time in the right Overview panel, keep the left turn outline visible, and surface unread counts with native taskbar highlighting when background turns finish.
- **Bilingual UI (`English` / `简体中文`)**: Switch between English and Simplified Chinese across Powertools panels and common native Antigravity menus and settings without first-paint flicker.
- **Local usage, error, and quota dashboard**: A dedicated `Powertools` sidebar page with a 53-week usage heatmap, model health timeline, token and cost donuts, request filters, one-click error copy, quota bars, and official API reference pricing.
- **Multi-account switching and quota management (opt-in)**: Isolate and switch multiple Google accounts locally via the OS keyring without storing plaintext tokens; integrates a bottom-left sidebar switcher with the native Settings entry, 5H/weekly quota views, list/card layouts, drag reordering, credential verification, and optional auto-switch on depletion.
- **No-TUN application proxy (opt-in)**: Configure an Antigravity-only proxy via protocol/host/port fields without modifying `app.asar` or creating proxy shortcuts; injects proxy args and environment variables on relaunch with built-in HTTP CONNECT / SOCKS5 connectivity testing, optional `GODEBUG=http2client=0` to mitigate `EOF` drops, and a cold-start relaunch prompt.
- **Session enhancements and verified updates**: Optional experimental context targets (`Default` / `256K` / `500K` / `1M`), optional Parallel search & read guidance, and SHA-256 verified in-app updates with automatic rollback on startup failure.

## Installation and uninstallation

### Requirements

- Install and launch Antigravity at least once first.
- Release packages already include prebuilt assets. Installation requires neither `npm install` nor administrator privileges; the installer uses Node.js `>= 22.13` when available and falls back to Antigravity's bundled `agy-node`.

### Install

#### Option 1: Let an Agent install it automatically (recommended)

Send the following prompt to Antigravity or another local coding agent:

> Please install Agy Powertools from https://github.com/chenfenger/agy-powertools . Clone this repository's main branch (do not use the upstream WhiteBr1ck/agy-powertools Releases), read README_EN.md and docs/INSTALL_AGENT.md first, and run the unified installer provided by the project using local Node.js or Antigravity's bundled runtime. Keep all other plugins, account settings, and chat history intact, and do not force-close the running client. Verify the installed version afterward and remind me if a client restart is needed.

#### Option 2: Command-line installation

Clone this repository (or click **Code → Download ZIP** on GitHub and extract it), then run the installer from the project directory:

```sh
git clone https://github.com/chenfenger/agy-powertools.git
cd agy-powertools
```

Then run the installer:

Windows (PowerShell):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

macOS / Linux:

```sh
sh ./install.sh
```

If Node.js `>= 22.13` is already installed, you can also run `node scripts/install.mjs`. The installer never force-closes Antigravity, and reinstalling preserves your saved preferences. Restart Antigravity after finishing your current task; **Powertools** will appear in the left sidebar.

### In-app updates

> This fork does not publish Releases, so **Check for updates** will not find new versions. To update, run `git pull` in the project directory and run the installer again (reinstalling keeps your settings).

Open **Powertools -> Settings -> About** and click **Check for updates**. When a verified stable release is available, click **Install update**. The updater verifies the SHA-256 digest, backs up the previous installation, swaps files, and confirms the new runtime attaches cleanly, rolling back automatically if startup fails.

### Uninstall

Run the uninstall script from the project directory to remove plugin files, registrations, caches, and runtime data (your native chat history, account, workspace files, and other plugins remain untouched):

Windows (PowerShell):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
```

macOS / Linux:

```sh
sh ./uninstall.sh
```

Append `--keep-settings` (for example, `node scripts/uninstall.mjs --keep-settings`) to retain your saved preferences.

## Key features in detail

### 1. Codex-like chat experience: Stage updates + Compact layout

Both **Stage updates** and **Compact layout** are enabled by default:

- **Show progress while working, fold when finished**: Before major tool steps, the model writes one or two short sentences stating current findings and the next action. Once the turn finishes, intermediate updates are automatically moved into the collapsed `Worked for ...` group at the top of the reply alongside tool records, leaving only the final answer visible. Click the turn duration anytime to expand the full process.
- **Same-font compact view**: Font size continues to follow your Antigravity setting. The plugin tightens body line height to `1.4`, unifies block and divider spacing, and reduces minimum tool-row height to `24px` so more code and context fit on one screen.

Side-by-side comparison using identical content, window width, and `14px` font size (about 19% shorter body height in this example):

![Standard layout vs. compact layout comparison](docs/images/layout-comparison.png)

### 2. Context window ring and dynamic speed gauge

Two independent controls sit in the composer (each can be toggled separately in Settings):

- **Context breakdown and Orchestrator view**: Displays actual input token usage and compaction count from the latest generation, split across Messages, System prompt, System tools, Skills, and Free space, plus cached vs. new input tokens for the step. In Orchestrator mode, separate context bars are shown for the planning and execution models.
- **Dynamic speed gauge and session telemetry**: Deflects the gauge needle and color by generation rate; clicking opens turn and step counts, total tokens, average / peak / latest speed (`tok/s`), cache hit rate, estimated 5-minute cache observation window, time to first token, and model vs. tool time.

### 3. Lossless session branching and inline message editing

- **Branch from any reply**: Every completed reply includes a `Branch to new chat` action, and the conversation menu adds `Fork conversation` (also available via `/branch-session`). New branches are automatically renamed with `(1)`, `(2)` suffixes, and conversations that invoked subagents offer a native prompt to branch cleanly from the last turn before the subagent call.
- **In-place native message editing**: Click the edit icon next to any sent user message to mount Antigravity's native rich Lexical composer directly in place, preserving quotes (`Ctrl+L`), `@` mentions, and image attachments while restoring any bottom draft on cancel.

### 4. Local usage, error, and quota dashboard

Click **Powertools** in the left sidebar to open five local analytics tabs:

- **Overview**: Filter by Last 24 hours, Yesterday, This week, This month, Last 30 days, All time, or a custom date range. Includes request success/error counts, input/output tokens, API reference cost, a 53-week usage heatmap, a model health timeline, paired token and cost donut charts, and per-model speed tables.
- **Requests**: Search and filter individual generations by model, conversation scope, and result, with per-request speed, latency, input, cache reads, cache hit rate, output, and estimated cost.
- **Errors**: Inspect failed requests by timestamp, model, and error summary, with one-click copy for the full error message.
- **Quota**: Reads native account quota endpoints to display your current plan badge (Pro / Ultra, etc.) and remaining 5-hour and weekly percentages, reset times, and sampled budget estimates for Gemini and Claude / GPT buckets.
- **Pricing**: Lists per-1M-token input, output, cache read, and cache write rates by model and reasoning effort, with one-click refresh from official Google AI Studio and Google Cloud pricing pages (for reference estimation only, not subscription billing).

### 5. Bilingual interface (`English` / `简体中文`)

Switch between `English` and `简体中文` at any time in **Powertools -> Settings**. Localization runs at initial paint without flicker and strictly excludes chat messages, composer inputs, and code blocks so conversations and source code are never altered.

### 6. Multi-account switching and quota management (opt-in)

Disabled by default and enabled in **Powertools -> Settings -> Accounts & switching** after a risk confirmation prompt:
- **Local OS keyring isolation**: Uses Windows Credential Manager, macOS Keychain, or Linux Secret Service to back up and swap account sessions locally with no plaintext token files, plus anti-clobber locking and credential hash duplicate detection.
- **Sidebar switcher and full manager**: Integrates your active account profile, plan badge, alias tag, and the native Settings button at the bottom of the left sidebar; the **Powertools -> Accounts & Quota** view supports list/card layouts, drag reordering, disabled-account guards, 5-hour/weekly quota views, credential checks, and optional auto-switch on depletion.

### 7. No-TUN application proxy (opt-in)

For users who want to proxy Antigravity alone without enabling a system-wide proxy or TUN adapter, available under **Powertools -> Settings -> Network proxy**:
- **No client patching or proxy shortcuts**: Leaves `app.asar` and desktop shortcuts untouched; provides protocol (`HTTP` / `SOCKS5` / `HTTPS`), host/IP, and port fields (with paste auto-split) and injects `--proxy-server`, `--proxy-bypass-list`, and `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` (always protecting local loopback) on relaunch.
- **Connectivity test, cold-start prompt, and account-switch harmony**: Includes real HTTP CONNECT / SOCKS5 tunnel probing, pre-relaunch port listening checks, optional `GODEBUG=http2client=0` (force HTTP/1.1 to mitigate idle `Post: EOF` disconnects), and a cold-start prompt banner whenever the window starts without proxy; multi-account and update restarts share the same relaunch path and preserve proxy settings automatically.

## Screenshots

### Native shell and context popover

![Native shell and context popover](docs/images/app-context.png)

### Speed telemetry popover and task progress

![Speed telemetry popover and task progress](docs/images/session.png)

### Usage overview (light and dark themes)

![Usage overview in light theme](docs/images/overview.png)

![Usage overview in dark theme](docs/images/overview-dark.png)

### Request events and quota bars

![Request events and cache hit rate](docs/images/requests.png)

![Subscription badge and quota bars](docs/images/quota.png)

<details>
<summary>More screenshots (Orchestrator context, usage distribution, error copy, pricing, and settings)</summary>

#### Orchestrator per-model context breakdown

![Orchestrator context breakdown](docs/images/orchestrator-context.png)

#### Token and cost distribution

![Token and cost distribution](docs/images/distribution.png)

#### Error events and one-click copy

![Error events and copy button](docs/images/errors.png)

#### Reference pricing and reasoning effort tiers

![Model reference pricing table](docs/images/pricing.png)

#### Settings and update manager

![Display and conversation enhancement settings](docs/images/settings.png)

</details>

## Configuration reference

All options can be toggled live in **Powertools -> Settings** and persist automatically (**Restore defaults** is available at the bottom of the page).

### Master switch

| Setting | Default | Description |
| --- | --- | --- |
| Enable Powertools | On | Master switch; turning it off pauses all UI injections and request overrides while keeping your saved preferences |

### Interface & display

| Setting | Default | Description |
| --- | --- | --- |
| Language | `简体中文` | Choose `简体中文` or `English` for Powertools panels and common native client UI menus |
| Compact layout | On | Tightens chat line height and block spacing while following the client font size |
| Always show conversation outline | On | Keeps the turn navigation rail visible in multi-turn chats even when Overview reserves space |
| Keep Overview open when switching chats | On | Preserves the open state of the right Overview panel across chats |
| Conversations per project | `Default (6)` | Controls how many conversations are shown per project in the sidebar (`Default (6)`, `1`, `2`, `3`, `4`, `5`, `10`, or `Show all`) before collapsing into "See all" |
| Taskbar unread reminder | On | Shows unread count in the taskbar title and highlights the window when background chats finish |

### Accounts & switching

| Setting | Default | Description |
| --- | --- | --- |
| Enable multi-account switching | Off | Opt-in with a first-time Google/Antigravity single-account risk confirmation. Stores and swaps credentials locally via the OS keyring (Windows Credential Manager / macOS Keychain / Linux Secret Service) without saving plaintext tokens |
| Sidebar account switcher | On (when enabled) | Integrates quick account switching and the native Settings entry at the bottom of the left sidebar with 5H/weekly quota toggling and one-click refresh |
| Auto switch when quota runs out | Off (when enabled) | Automatically switches to the best enabled account when a 5-hour or weekly bucket is depleted, with a 120s cooldown and active-turn deferral |
| Default account view | `List view` | Default layout for the Accounts & Quota manager (`List view` or `Card view`), with drag-to-reorder and credential verification |
| Default quota window | `5-hour limit` | Controls whether the sidebar popover and list view display `5-hour limit` or `Weekly limit` |

### Telemetry & progress

| Setting | Default | Description |
| --- | --- | --- |
| Context ring | On | Shows the context usage ring and breakdown popover in the composer (including step cache reuse and Orchestrator per-model context; ring-only at 0 usage) |
| Speed & statistics | On | Shows a circular dynamic speed dial with latest throughput in the composer and opens session telemetry |
| Task progress | On | Renders checklist progress, recent tool activity, and elapsed timer inside Overview |
| Turn duration | On | Displays completion duration at the top of each finished turn |
| Expand tools from duration | On | Click the turn duration label to expand or collapse tool calls and stage updates |

### Conversation enhancements

| Setting | Default | Description |
| --- | --- | --- |
| Stage updates | On | Codex-style live progress updates while the agent works, folded automatically on completion |
| Parallel search & read | Off | Guides the agent to batch file searches and reads in the same turn to reduce round trips |
| Conversation branching | On | Enables Antigravity's native conversation branching from menus and replies, with automatic `(1)` naming and pre-subagent fallback |
| Message editing | On | Enables native in-place message editing with full support for quotes, `@` mentions, and images |
| File context menu | On | Right-click local `file://` file links in messages to open with the default app, show in folder, copy the file, or copy its path |

### Network proxy

| Setting | Default | Description |
| --- | --- | --- |
| Application proxy (no TUN) | Off | Opt-in. Injects `--proxy-server`, `--proxy-bypass-list`, and `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` on relaunch without patching `app.asar` or creating proxy shortcuts; includes protocol/host/port split fields, HTTP CONNECT / SOCKS5 connectivity testing, pre-relaunch port checks, and a cold-start relaunch prompt |
| Force HTTP/1.1 (mitigate EOF) | Off (when enabled) | Injects `GODEBUG=http2client=0` to disable Go HTTP/2 connection reuse and mitigate idle `Post: EOF` disconnects |

### Context (Experimental)

| Setting | Default | Description |
| --- | --- | --- |
| Context target | `Default` | Choose `Default`, `256K`, `500K`, or `1M`. `Default` leaves Antigravity's native context configuration untouched; other options set the compaction threshold and token cap starting from the next request (`Observed limit` is shown below) |

### Environment variables and storage paths

| Name / Path | Description |
| --- | --- |
| `ANTIGRAVITY_USER_DATA_DIR` | Custom Antigravity user-data directory when running an isolated client profile |
| `ANTIGRAVITY_CDP_PORT_FILE` | Explicit path to the client `DevToolsActivePort` file (also honors `AGY_BROWSER_ACTIVE_PORT_FILE`) |
| `~/.gemini/config/plugins/agy-powertools/` | Installed plugin program and runtime scripts |
| `~/.gemini/antigravity/plugin_data/agy-powertools/` | User preferences (`settings.json`), component cache, and official pricing cache |

## Changelog

### v2.13.0

This is a major release introducing **multi-account switching & quota management** and a **no-TUN application proxy**, along with Antigravity 2.34.0 compatibility and stability fixes.

- **Antigravity 2.34.0 compatibility**: Updated the native toast notification hook (`um`) matcher and made it optional so client updates to toast internals do not block plugin initialization.
- **Opt-in multi-account switching (disabled by default with risk confirmation)**:
  - Stores and swaps multiple Google account sessions locally via OS native keyrings (Windows Credential Manager / macOS Keychain / Linux Secret Service) with `pendingSwitch` anti-clobber locking and credential hash duplicate detection.
  - Integrates a bottom-left sidebar account switcher with the native Settings entry; adds an Accounts & Quota management view supporting list/card layouts, drag reordering, disabled-account switch guards, persistent 5H/weekly quota window switching, `Argon` quota grouping, quota/credential refresh, and optional auto-switch on depletion.
  - Scopes quota cycle sampling per account and updates Windows auto-relaunch to use UTF-16LE `-EncodedCommand` with Explorer Desktop COM breakaway.
- **Opt-in no-shortcut application proxy (disabled by default)**:
  - Injects Chromium proxy flags and `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` across Windows, macOS, and Linux on relaunch without modifying `app.asar` or system shortcuts.
  - Adds protocol/host/port split fields (with paste auto-split), loopback-protected `NO_PROXY`, real HTTP CONNECT / SOCKS5 tunnel connectivity tests, optional `GODEBUG=http2client=0` (force HTTP/1.1), pre-relaunch port listening checks, and a cold-start prompt banner when the window launched without proxy.
  - Shares the same relaunch pipeline and guard with multi-account switching and update restarts so configured proxy settings carry across restarts seamlessly.
- **Fixes and UI refinements**:
  - Fixed in-place message editing losing state and leaking edited text/images into the bottom composer when switching conversations: now suspends active edits per conversation while restoring the original bottom draft, and automatically resumes the inline editor on return.
  - Fixed oversized remote badge banners inside Antigravity's Installed Plugin overview (#5) by replacing the shields.io badge block in packaged `README.md` / `README_EN.md` with a single-line plain text summary while keeping the GitHub repository pages unchanged.
  - Refined Settings page font weights to avoid heavy bold labels on Windows, fixed `renderRoot` redundant `insertBefore` calls and sidebar entry positioning, and removed a duplicate `Reset` translation entry.

### v2.12.10
- Fixed "Restart to Enable" not responding or failing to reopen Antigravity:
  - On Windows, launches a self-cleaning relaunch script via `Win32_Process.Create` outside Antigravity's Job Object, and checks `process.execPath` and `Program Files` for custom installation paths.
  - On macOS, falls back to `SIGTERM` when AppleScript quit does not exit the process.
  - Updated the Aux Pane prompt copy, added error/timeout recovery (15s), and exposed a one-click `Copy launch command` fallback.
- Relaxed `isHubTarget` title matching to include remote SSH/WSL window suffixes such as `(SSH: ...)` and `[SSH: ...]` (#4).

### v2.12.9
- Fixed continuous page flickering when multiple conversation panes or Side Questions are open (#3): updated the health check to match the actual number of composer triggers instead of assuming a single ring, stopping the 4-second dispose/re-inject loop.
- Improved SSH remote mode handling (#4): headless remote SSH hosts now show an SSH compatibility notice in the Aux Pane instead of an ineffective restart prompt; when local Node fetch of `/main.js` fails with `ECONNREFUSED`, discovery falls back to page-context `fetch('/main.js')` via CDP.
- Added `Conversations per project` setting under `Settings -> Interface & display` to customize sidebar per-project visible counts or show all while preserving native `See all / See less` pagination.
- Fixed Orchestrator pricing, grouping, and Gemini quota attribution: merged `Orchestrator (Neon / Carbon / Argon)` into their catalog model IDs, estimated planner and execution (including `Hydrogen`) costs using underlying model rates, and included Orchestrator requests in Gemini quota calculations.
- Refined Overview charts and tables: unified the usage heatmap to a consistent `53 x 7` cell grid scaled to the active date range, switched range separators to `-`, and filtered `Model statistics` to active models with donut-matched color dots.

### v2.12.8
- Fixed `Errors` tab table isolation and empty error rows: separated `Requests` and `Errors` `EventTable` instances by key so table DOM and filter state never leak across tabs, filtered out blank `ERROR_MESSAGE` steps, sorted merged errors descending by timestamp, and marked retry error entries with `status: 'error'`.
- Refined Orchestrator context display and role detection: show the multi-model section only when at least 2 models have run, moved the token fraction next to the progress bar so `Orchestrator` displays without truncation, and inferred planner/execution roles across the full session using `executionModelEnum`.
- Added Simplified Chinese translations for the native Usage popover (`5h limit`, `N% left`, and `Resets in ...`).

### v2.12.7
- Fixed composer footer overlap when the side panel narrows the main chat column: uses `@container input-footer` CSS container queries to progressively collapse speed and context labels into icon buttons with hover titles and overflow containment.
- Added missing Simplified Chinese translations for the conversation `Copy` and `Split` submenus, side panel actions (`Search or enter a URL`, `Open File`, `See all`), Side Question panel (`Side Question`, `New Side Question`, empty-state prompt), and `N files changed` counters.

### v2.12.6
- Added a native context menu for local `file://` links in messages (idea inspired by #2, thanks `@chenfenger`): right-click to open with the default app, show in folder, copy the file, or copy its path, with a toggle under `Settings -> Conversation enhancements`.
- Cross-platform and safety handling: runs file clipboard copy asynchronously to avoid blocking the background host; blocks direct Windows shell execution for runnable script/executable extensions (`.js`, `.bat`, `.cmd`, `.ps1`, `.exe`, etc.) with a notice; rejects remote `file://` hosts and uses `pathToFileURL` encoding across platforms.

### v2.12.5
- Fixed macOS "Restart to Enable" failing when the previous Antigravity process had not finished exiting (#1, thanks `@niuanhua-ydy`): replaced `pgrep -f` with `/bin/ps` and `/usr/bin/awk` path-prefix matching, added `trap '' HUP TERM`, and extended the exit wait window.
- Updated the Linux relaunch script to use `trap '' HUP TERM` and `ps` + `awk` process checks as well.

### v2.12.4
- **Taskbar unread reminder**: Displays `(N)` unread count in the taskbar title and triggers native Windows attention highlighting when background or unfocused chats finish, clearing automatically on focus (configurable in Settings).
- **Split Context & Speed popovers**: Split the tall combined popover into dedicated **Context ring** and **Speed & statistics** controls (each independently toggleable), featuring a circular dynamic speedometer dial matched 1:1 to the context ring.
- **Step cache reuse & Orchestrator context**: Added per-step cached context vs. new input rows, compaction badge, and automatic Orchestrator planner/execution per-model context bars.
- **Gemini 4 Neon pricing & zero-jank navigation**: Added official `gemini-4-neon` and `gemini-4-hydrogen` baseline pricing, labeled Orchestrator presets as billed per underlying model, parallelized price fetching with proxy support, added sidebar pointerdown prefetch + 32-chat cache for instant smooth session switching, unified Requests/Errors row heights, and fixed host target matching when unread title badges are active.

### v2.12.3
- **Antigravity 2.33.0 compatibility**: Automatic cross-platform shortcut launch flag management with clean uninstall restore, background self-healing across client updates, and a one-click restart helper.
- **In-place native rich message editing**: Relocates the native Lexical composer directly to the edited message with full support for selection quotes (`Ctrl+L`), `@` mentions, image attachments, and draft restoration on cancel.
- **Improved conversation branching**: Automatically renames forked conversations with `(1)`, `(2)` suffixes and offers a native modal to branch from the last turn before a subagent invocation.
- **UI & quota refinements**: Redesigned the context popover with Claude Desktop-inspired multi-color segments and aligned columns (ring-only when usage is 0); narrowed Settings to match official readability with a fixed non-jumping header bar while keeping wide tables on Requests and Errors; updated 100% quota estimation to reconcile full-cycle usage from the exact reset start timestamp.

### v2.12.2
- Restored smooth native Overview panel open/close transitions when `Always show conversation outline` is enabled.
- Renamed the context settings group to `Context (Experimental)` and added a `Default` option that leaves Antigravity's native context settings untouched.
- Added missing Simplified Chinese translations for the selection quote popup, composer permissions menu, and Overview section headers, and linked the project name in `About` directly to GitHub.

### v2.12.1
- Improved task progress lifecycle detection using native execution snapshots to accurately distinguish running, stopping, stopped, and terminal error states across upstream retries.

### v2.12.0
- Added in-app update checking and SHA-256 verified installation with an independent worker process, health confirmation, and automatic rollback on failure.
- Added safe in-place file replacement fallback for occupied Windows runtime directories.

### v2.11.0
- Added component declaration caching for faster startup and reload recovery.
- Redesigned paired token and cost distribution donuts in Overview and added the `About` section in Settings.

### v2.10.0
- Adapted component discovery and dynamic endpoint reconnection for Antigravity 2.32.x.
- Added the `Enable Powertools` master switch and reorganized `Conversation enhancements` settings.

## Feedback and license

- **License**: Released under the [MIT License](LICENSE).
- **Issues**: If the sidebar entry disappears or UI components break after an Antigravity client update, please open an issue on [GitHub Issues](https://github.com/WhiteBr1ck/agy-powertools/issues) with your OS, Antigravity version, and Agy Powertools version.
- **Acknowledgements**: The custom date-range calendar interaction in the dashboard is adapted from HextaUI and built with `react-day-picker` and `date-fns`. Third-party license notices are in [lib/vendor/NOTICE.txt](lib/vendor/NOTICE.txt).

## Links

- [LINUX DO](https://linux.do/)
