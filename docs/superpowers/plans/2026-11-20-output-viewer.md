# Output Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local, read-only web server (`npm run serve`, `Run-Project.ps1 -Serve`) for comparing each different
policy's NHI and MRP screenshots side by side.

**Architecture:** `src/viewer-data.ts` turns the output folder into JSON using the summary's own
`summarisePolicyFolder` (as built; shared with `collectQuoteResults`); `src/viewer-server.ts` serves that JSON, the policy files and a static page from
`src/viewer/` on Node's `http` module; `main.ts` adds the `serve` command; `Run-Project.ps1` and
`Read-InteractiveRun.ps1` start it.

**Tech Stack:** TypeScript (strict, NodeNext), Node `http`, plain HTML/CSS/JS in the browser, `node --test` with
Playwright for the page test, Pester for PowerShell.

**Spec:** `docs/superpowers/specs/2026-11-20-output-viewer-design.md`

## Global Constraints

- No new runtime or dev dependencies. Playwright and `sharp` (already dependencies) may be used in tests.
- Listens on `127.0.0.1` only. Default port `4173`.
- Read-only: no route writes, renames or deletes anything.
- Only files directly in a `<policyDetailsId>-<historyId>` folder (`policyFolderPattern`) are served; never a subfolder,
  never outside the output folder.
- No caching between requests: every `/api` response re-reads the folder and sends `Cache-Control: no-store`.
- "Different" = compared policies with `kind === 'different'`, including cover type re-checked ones, as the full
  summary counts them. "Different, not re-checked" = the same without `coverTypeRecheck`.
- The output folder is resolved as `summarise` resolves it (`outputPath()`, so `OUTPUT_DIR`, `.env` and
  `QUOTE_JOURNEY_RUN_NAME` / `-RunName` apply).
- Every task ends with `npm run build`, the task's tests passing, ESLint clean and Prettier run on the touched files.
  PowerShell edits are formatted with `Format-PowerShellFiles.ps1`. Tests mark `// arrange`, `// act`, `// assert`.
- Commits go to `main` (this project's override). Stage only the task's files.

## Review Focus

1. **Paths that try to escape:** `..`, `%2e%2e`, `%2F`, `%5C`, a drive letter, an absolute path, a subfolder file
   (`api-nhi/001.json`), a non-policy folder (`mrp-and-quote`, `.ocr-cache`). Expected: `404`, nothing read. Owned by
   Task 2.
2. **A run still writing:** a policy folder with `report.json` but no screenshots yet, or a `result.json` not yet
   written. Expected: the list still loads; the detail lists only the images that exist and the page says which are
   missing rather than showing broken images. Owned by Tasks 1 and 4.
3. **Screenshots of different heights** (`sizeDifference`, e.g. 1440×100 vs 1440×120). Expected: both drawn at the same
   scale from the top, so pixel rows line up and the shorter one simply ends; scroll stays locked. Owned by Task 4.
4. **Nothing to show:** an empty output folder, or no different policies. Expected: the server starts, the page says
   "No different policies" and shows the output folder path. Owned by Tasks 1 and 4.
5. **Port already in use.** Expected: `serve` exits non-zero with `Port <n> is in use; choose another with --port (-Port in Run-Project.ps1)` (`-Port` from
   Run-Project.ps1), not a stack trace. Owned by Task 3.

---

### Task 1: Viewer data from the output folder

**Files:**

- Create: `src/viewer-data.ts`
- Modify: `src/summarise.ts` (export the re-check wording)
- Test: `scripts/viewer-data-test.mjs`

**Interfaces:**

- Consumes: `collectQuoteResults(root)`, `ComparedPolicy`, `QuoteResultsSummary` (`src/summarise.ts`);
  `readQuoteResult(dir)` (`src/quote-result.ts`); `flowOutputPaths` (`src/flow-output.ts`); `describeEndpoints`
  (`src/quote-endpoint.ts`); `nameCoverType` (`src/quote-changes.ts`).
- Produces:
  - `export function describeCoverTypeRecheck(recheck: CoverTypeRecheck): string` in `src/summarise.ts`: the
    summary's wording, `"<outcome description>; was <cover type> on NHI"`, using `coverTypeRecheckDescriptions` /
    `noCoverTypeRecheckOutcome`. `printCoverTypeRechecks` keeps its output unchanged.
  - `export type ViewerPolicyKind = ComparisonKind | 'failed' | 'declined' | 'unrecorded'`
  - `export interface ViewerPolicy { name: string; kind: ViewerPolicyKind; changedPercent?: number; sizeDifference?:
string; hasTextDifferences: boolean; endpoints?: string; coverTypeRecheck?: string }` (`endpoints` is
    `describeEndpoints`'s text; `coverTypeRecheck` is `describeCoverTypeRecheck`'s).
  - `export interface ViewerRun { root: string; runName?: string; environment?: string; policies: ViewerPolicy[] }`
  - `export async function listViewerPolicies(root: string, run: { runName?: string; environment?: string }):
Promise<ViewerRun>`: every policy in folder order (compared, failed, declined, unrecorded).
  - `export interface ViewerRegion { id: number; bounds: { left: number; top: number; width: number; height: number };
removed: string[]; added: string[]; lowConfidence: boolean }`
  - `export interface ViewerPolicyDetail extends ViewerPolicy { imageScale?: number; images: { nhi?: string; mrp?:
string; diff?: string; failedNhi?: string; failedMrp?: string }; regions: ViewerRegion[]; issues: string[];
answerChanges?: unknown; endorsementOrderDiffers: boolean }` (image values are file names in the folder, set only
    when the file exists).
  - `export async function readViewerPolicyDetail(root: string, folder: string): Promise<ViewerPolicyDetail |
undefined>`: `undefined` when `folder` is not a policy folder or does not exist.

- [ ] **Step 1: Write the failing tests** in `scripts/viewer-data-test.mjs`, with a fixture written like
      `summarise-test.mjs`'s (a different policy with two regions and text changes, an identical one, a re-checked
      different one with `originalCoverType: 'C'` and `outcome: 'matched'`, a failed one with `screenshot-failed-nhi.png`,
      an unrecorded empty folder, and `mrp-and-quote/` and `.ocr-cache/` folders):
  - `lists every policy with the summary's kinds`: kinds per folder; `mrp-and-quote` and `.ocr-cache` absent;
    the count of `kind === 'different'` equals `collectQuoteResults`' different count.
  - `marks a re-checked policy with the summary's wording`: `coverTypeRecheck` starts with
    `'Matched MRP: buildings, contents'` and ends with `'was Contents only on NHI'`.
  - `reads a different policy's regions, images and answer changes`: two regions with their bounds and removed/added
    lines; `images.nhi === 'screenshot-quote-page-nhi.png'`, `images.mrp === 'screenshot-quote-page-mrp.png'`,
    `images.diff === 'diff.png'`; `imageScale` from `report.json`; `answerChanges` from `answer-changes.json`.
  - `leaves out images not written yet` (Review Focus 2): delete the MRP screenshot; `images.mrp` is `undefined`,
    the rest unchanged.
  - `reads a failed policy's issues and failure screenshot`: `issues` equals `result.json`'s; `images.failedNhi`.
  - `returns undefined for a folder that is not a policy`: `'mrp-and-quote'`, `'..'`, `'missing-1'`.
  - `lists nothing for an empty folder` (Review Focus 4): `policies` is `[]`.
- [ ] **Step 2:** `npm run build && node --import ./scripts/test-setup.mjs --test scripts/viewer-data-test.mjs` —
      expected FAIL (module not found).
- [ ] **Step 3: Implement** `describeCoverTypeRecheck` and `src/viewer-data.ts`. The NHI and MRP image names come
      from `report.json`'s `before` / `after` basenames when that file is in the folder (declined captures save
      `screenshot-declined-*.png`), else `flowOutputPaths`. Check existence with `readdir` of the folder once.
- [ ] **Step 4:** run Step 2's command — expected PASS; `npm test` still passes (summarise output unchanged).
- [ ] **Step 5: Commit** `src/viewer-data.ts src/summarise.ts scripts/viewer-data-test.mjs` — `feat: viewer data
from the output folder`.

### Task 2: Viewer HTTP server

**Files:**

- Create: `src/viewer-server.ts`, `src/viewer/index.html` (placeholder `<title>Output viewer</title>`; Task 4 fills it)
- Test: `scripts/viewer-server-test.mjs`

**Interfaces:**

- Consumes: Task 1's `listViewerPolicies`, `readViewerPolicyDetail`; `projectRoot` (`src/output-paths.ts`).
- Produces:
  - `export interface ViewerServerOptions { root: string; port: number; run: { runName?: string; environment?: string
}; staticDir?: string }` (`staticDir` defaults to `join(projectRoot, 'src', 'viewer')`, which works from both
    `src/` under tsx and `dist/`).
  - `export async function startViewerServer(options: ViewerServerOptions): Promise<{ url: string; port: number;
close(): Promise<void> }>`: binds `127.0.0.1`; `port: 0` picks a free port; rejects with
    `Error('Port <n> is in use; choose another with --port (-Port in Run-Project.ps1)')` on `EADDRINUSE`.
  - Routes (GET and HEAD only; anything else `405`): `/` → `index.html`; `/viewer.css`, `/viewer.js` → those files;
    `/api/policies` → `ViewerRun`; `/api/policies/<folder>` → `ViewerPolicyDetail` or `404`;
    `/files/<folder>/<file>` → the file or `404`. Unknown paths `404`.

- [ ] **Step 1: Write the failing tests**, starting the server on `port: 0` against Task 1's fixture (copy its fixture
      builder into a shared `scripts/viewer-fixture.mjs` and use it from both tests):
  - `serves the page and its JSON without caching`: `/` is `text/html`; `/api/policies` is JSON with the fixture's
    policies; both have `cache-control: no-store`.
  - `serves a policy's screenshot as a PNG`: `/files/<different>-1/screenshot-quote-page-nhi.png` is `200 image/png`
    with the file's bytes.
  - `refuses paths outside the policy folders` (Review Focus 1), table-driven, each `404`: `/files/..%2F..%2Fetc/x`,
    `/files/<p>-1/..%2Freport.json`, `/files/<p>-1/%2e%2e%5Creport.json`, `/files/C:%5CWindows/win.ini`,
    `/files/<p>-1/api-nhi%2F001.json`, `/files/mrp-and-quote/x-1-mrp.json`, `/files/.ocr-cache/x`,
    `/api/policies/..`.
  - `picks up a policy written after it started`: add a policy folder after the first `/api/policies`; the second call
    lists it.
  - `rejects writes`: `POST /api/policies` is `405`.
  - `reports a port in use` (Review Focus 5): start one server, start a second on its port; rejects with
    `/Port \d+ is in use; choose another with --port/`.
- [ ] **Step 2:** `npm run build && node --import ./scripts/test-setup.mjs --test scripts/viewer-server-test.mjs` —
      expected FAIL.
- [ ] **Step 3: Implement** `src/viewer-server.ts`. Decode the path once, then require the folder to match
      `policyFolderPattern` and the file to be in that folder's `readdir` listing as a regular file; never join an
      unchecked segment. Content types: `.png` `image/png`, `.html` `text/html; charset=utf-8`, `.css`, `.js`, `.json`.
      Stream files with `createReadStream`.
- [ ] **Step 4:** run Step 2's command — expected PASS.
- [ ] **Step 5: Commit** `src/viewer-server.ts src/viewer/index.html scripts/viewer-server-test.mjs
scripts/viewer-fixture.mjs scripts/viewer-data-test.mjs` — `feat: viewer server`.

### Task 3: `serve` command

**Files:**

- Create: `src/open-browser.ts`
- Modify: `src/main.ts` (help, `serve` dispatch, `runServe`), `package.json` (`"serve": "tsx src/main.ts serve"`,
  kept in the scripts' existing order)
- Test: `scripts/serve-test.mjs`

**Interfaces:**

- Consumes: Task 2's `startViewerServer`; `outputPath()`; the environment and run name as `resolveOutputFolders`
  reads them.
- Produces: `npm run serve [-- --port <n>] [--no-open]`; prints `Viewer: <url> (output: <folder>). Ctrl+C to stop.`
  as its first line; `export function openBrowser(url: string): void` (`cmd /c start "" <url>` on win32, `open` on
  darwin, else `xdg-open`; spawned detached, errors logged in grey and ignored).

- [ ] **Step 1: Write the failing tests** (spawn `dist/main.js` as `summarise-test.mjs`'s `runCli` does, with
      `OUTPUT_DIR` set to a fixture):
  - `serves the output folder`: `serve --port 0 --no-open`; read the first line's URL; `/api/policies` lists the
    fixture; kill the child.
  - `rejects a port that is not a number`: `serve --port abc` exits 1 with `--port must be a whole number from 0 to
65535` and the usage line.
  - `reports a port in use` (Review Focus 5): occupy a port with `net.createServer`; `serve --port <n> --no-open`
    exits 1 with `Port <n> is in use; choose another with --port (-Port in Run-Project.ps1)`, no stack trace.
  - `--help` prints the serve usage.
- [ ] **Step 2:** `npm run build && node --import ./scripts/test-setup.mjs --test scripts/serve-test.mjs` — expected
      FAIL.
- [ ] **Step 3: Implement** `runServe(args)` with `parseArgs` (`port` string, `no-open` boolean, `help`), following
      `runSummarise`'s usage-error pattern, add `serve` to `help`, keep the process alive until SIGINT, then `close()`.
- [ ] **Step 4:** run Step 2's command — expected PASS.
- [ ] **Step 5: Commit** `src/main.ts src/open-browser.ts package.json scripts/serve-test.mjs` — `feat: serve command
for the output viewer`.

### Task 4: Viewer page

**Files:**

- Modify: `src/viewer/index.html`
- Create: `src/viewer/viewer.css`, `src/viewer/viewer.js` (plain browser JS, no modules needed; linted by the existing
  ESLint config's browser globals)
- Test: `scripts/viewer-page-test.mjs` (Playwright Chromium against Task 2's server on the shared fixture; fixture PNGs
  made with `sharp`, NHI 40×100, MRP 40×120)

**Interfaces:**

- Consumes: Task 2's routes and Task 1's JSON shapes.
- Produces: the page. Element hooks the test relies on: `#filter` (`<select>` with values `different`,
  `different-not-rechecked`, `identical`, `endpoints`, `failed`, `all`), `#policy-list li[data-name]`,
  `#mode button[data-mode]` (`side`, `slider`, `blink`, `diff`), `#regions button[data-region]`, `#region-text`,
  `#pane-nhi img`, `#pane-mrp img`, `#details`, `#empty`.

- [ ] **Step 1: Write the failing tests:**
  - `lists the different policies by default`: `#filter` is `different`; list items equal the fixture's different
    count, including the re-checked one with text containing `cover re-checked`.
  - `filters out re-checked policies`: choose `different-not-rechecked`; the re-checked one is gone.
  - `shows both screenshots of the selected policy`: click the different policy; `#pane-nhi img` and `#pane-mrp img`
    `src` end with the two screenshot names; `location.hash` is `#<folder>`; `#details` contains the answer change
    (`rebuilding cost` and its before and after values) and the end points text.
  - `keeps rows aligned when the heights differ` (Review Focus 3): both images have the same rendered width and
    rendered heights in the ratio 100:120; scrolling `#pane-nhi` to 50px sets `#pane-mrp` scrollTop to 50.
  - `shows a region's text change`: click `[data-region="2"]`; `#region-text` contains the removed and added lines.
  - `switches to the diff image`: click `[data-mode="diff"]`; one image whose `src` ends `diff.png`.
  - `reopens the policy in the hash`: load `/#<folder>`; it is selected.
  - `moves with J and K`: press `j`; the next list item is selected; `k` returns.
  - `shows a failed policy's issues and screenshot`: filter `failed`, select it; `#details` contains the issue text
    and an image ending `screenshot-failed-nhi.png`.
  - `says which screenshot is missing` (Review Focus 2): fixture policy without its MRP screenshot shows
    `MRP screenshot not saved` in `#pane-mrp`, no `<img>`.
  - `says when there is nothing to show` (Review Focus 4): server on an empty folder; `#empty` reads
    `No different policies` and contains the folder path.
- [ ] **Step 2:** `npm run build && node --import ./scripts/test-setup.mjs --test scripts/viewer-page-test.mjs` —
      expected FAIL.
- [ ] **Step 3: Implement** the page as in the spec's layout A. Both images get the same CSS width (the pane width ×
      zoom), so heights keep their ratio; region outlines are absolutely positioned boxes at `bounds` × the displayed width over the screenshot's width (as built: bounds are in screenshot pixels, so
      `imageScale` is not applied) ×
      displayed scale. Slider: MRP over NHI with `clip-path` from a range input. Blink: toggles which image is visible
      every 500 ms. The hash holds the folder name; `hashchange` selects it. Refresh = reload `/api/policies` keeping the
      selection.
- [ ] **Step 4:** run Step 2's command — expected PASS.
- [ ] **Step 5: Commit** `src/viewer/ scripts/viewer-page-test.mjs scripts/viewer-fixture.mjs` — `feat: output viewer
page`.

### Task 5: Run-Project.ps1 `-Serve`, `-Interactive` and docs

**Files:**

- Modify: `Run-Project.ps1` (help, parameter set `Serve` with `-Serve`, `-Port` and the existing `-RunName`;
  `Get-CliArguments`; overview line after `-Summarise`'s), `scripts/Read-InteractiveRun.ps1` (task `View results`,
  after `Summarise only`), `README.md` (a "Viewing the results" section and the commands list)
- Test: `scripts/Run-Project.Tests.ps1`, `scripts/Read-InteractiveRun.Tests.ps1`

**Interfaces:**

- Consumes: Task 3's `serve [--port <n>]`.
- Produces: `./Run-Project.ps1 -Serve [-Port <0-65535>] [-RunName <name>]` → `{cli} serve [--port <n>]`; the
  interactive task `View results` asks only for the run name (no environment, options or clearing) and returns one
  step `[ordered]@{ Serve = $true }` plus the run name, with no Summarise after it.

- [ ] **Step 1: Write the failing tests:** command-line rows `serve starts the viewer` (`-Serve` → `{cli} serve`) and
      `serve passes Port` (`-Serve -Port 5000` → `{cli} serve --port 5000`); a validation row rejecting `-Port 70000`;
      `-Serve -RunName temp2 -WhatIf` sets the run name as `-Summarise -RunName` does (follow the existing run-name
      test); the overview lists `-Serve`; an interactive test choosing `View results` returns exactly one step with
      `Serve` and the run name.
- [ ] **Step 2:** `pwsh -NoProfile -Command 'Invoke-Pester ./scripts -CI'` — expected FAIL on the new tests.
- [ ] **Step 3: Implement**, then format both scripts with
      `pwsh -File $env:REPO_BASE_PATH\Tools\Scripts\Format-PowerShellFiles.ps1 -Path <file>`. Update the README: how to
      start it, the port, that it is read-only and local-only, the filters and the keys.
- [ ] **Step 4:** run Step 2's command — expected PASS; then `./VerifyProject.ps1` prints `Done` with no
      `FAILED at:`.
- [ ] **Step 5: Commit** `Run-Project.ps1 scripts/Read-InteractiveRun.ps1 scripts/Run-Project.Tests.ps1
scripts/Read-InteractiveRun.Tests.ps1 README.md` — `feat: start the output viewer from Run-Project.ps1`.
