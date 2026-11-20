# Output viewer: design

## Intent

After a quote-pages run, the terminal summary says which policies came out different, but checking why means opening
each policy folder and its screenshots by hand. The viewer is a local web page for working through those policies: the
NHI and MRP screenshots of each one side by side, with the changed regions and their text changes, moving from policy to
policy without leaving the browser.

## Goals

- List one run's policies, defaulting to those the full summary (`summarise`, its Totals line and `-RetryDifferent`)
  counts as different, with the same counts.
- For a compared policy, show the NHI and MRP full-page screenshots side by side, scrolling and zooming together, with
  the changed regions outlined.
- Other ways to compare the same pair: a slider (MRP over NHI, split by a draggable line), blink (alternating NHI and
  MRP in one place), and the saved `diff.png`.
- Jump to each changed region and show its OCR text change (removed and added lines, low-confidence flag).
- Show the answer changes the run made (`answer-changes.json`) and where each flow ended (`result.json` end points).
- Keyboard: J / K for the next and previous policy in the list.
- Started from `Run-Project.ps1` and its `-Interactive` menu, like the other commands.

## Non-goals

- Comparing the same policy across two runs (a later addition, reusing the viewer).
- Re-running, retrying or deleting anything; the server is read-only.
- Re-running OCR or the pixel comparison; it shows what the run saved.
- Viewing or linking to the saved API responses (`api-nhi/`, `api-mrp/` and the older `nhi-api/`, `tcas-api/`). Only
  files directly in a policy folder are served; a subfolder route can be added later (decided in review, builder's
  call).

## Anti-goals

- A list that disagrees with the terminal summary (its own idea of "different").
- Anything reachable from other machines: it serves customer test data and must listen on `localhost` only.
- New runtime dependencies or a separate front-end build for one page.
- Loading every screenshot at full size up front: they are around 2160 × 11540 pixels each, over a thousand policies.

## Constraints

- TypeScript in this project, strict, ESLint and Prettier, tests with `node --test` in `scripts/*-test.mjs` against
  `dist/`, as the existing commands are tested. `VerifyProject.ps1` must pass.
- The output folder is resolved exactly as `summarise` resolves it: `OUTPUT_DIR`, the environment in `.env`, and
  `QUOTE_JOURNEY_RUN_NAME` / `-RunName` (`src/output-paths.ts`).
- New PowerShell follows `PowerShell.md`: the formatter, and the strict preamble for any new script. `Run-Project.ps1`
  parameters stay in step with `src/main.ts`, and its Pester tests (`scripts/Run-Project.Tests.ps1`,
  `scripts/Read-InteractiveRun.Tests.ps1`) cover the new switch and menu entry.

## Approaches

1. **A `serve` command in this tool (chosen).** A server on Node's built-in `http` module, started by
   `npm run serve` and `Run-Project.ps1 -Serve`. It reuses the summary's classification (`summarisePolicyFolder`, shared with `collectQuoteResults`),
   serves one static HTML/CSS/JS page, and reads the policy folders on each request, so a refresh shows new results
   during a run. No new dependencies.
2. **A static HTML report** written by `summarise --html`. No server, but it must be regenerated after every run, and
   browsers can block a local file from loading images outside its folder.
3. **A separate front-end app** (for example Vite and React). Richer controls, but a second project with its own
   tooling for one page, and it would have to re-create the summary's grouping.

Approach 1 was picked: it is what was asked for (a server), it cannot drift from the summary, and it adds nothing to the
dependencies. Layout A (list on the left, full screenshots side by side) was picked over a page of changed-region crops.

## Design

### Starting it

- `npm run serve` → `tsx src/main.ts serve [--port <n>] [--no-open]`. Default port 4173. It prints the URL and
  opens the default browser unless `--no-open`. Ctrl+C stops it.
- `Run-Project.ps1 -Serve [-Port <n>] [-RunName <name>]`: a new parameter set, documented in the script's help and
  overview like `-Summarise`, with `-WhatIf` printing the command.
- `-Interactive`: a new task, "View results", which asks only for the run name (as "Summarise only" does) and runs
  `-Serve`.
- It binds to `127.0.0.1` only. If the port is taken it fails with `Port <n> is in use; choose another with --port (-Port in Run-Project.ps1)`.

### Server

- Routes (all `GET`):
  - `/` and static assets: the viewer page, from a folder in the project (for example `src/viewer/`, copied to
    `dist/` by the build or served from `src/`; builder's call).
  - `/api/policies`: every policy as `collectQuoteResults` sorts it, each with its folder name, kind (identical, different,
    matching end point, failed, declined, unrecorded), changed %, size difference, whether it has text differences,
    its end points and its cover type re-check (outcome and previous cover type) when set. Also the run (environment and run name) and the output folder, for the header.
  - `/api/policies/<folder>`: one policy's detail: its `report.json` regions (id, bounds, text changes, confidence),
    `answer-changes.json` if present, `result.json` issues, and the names of its image files.
  - `/files/<folder>/<file>`: a file from a policy folder (screenshots, `diff.png`, region crops, failure screenshot).
- Folder and file names are checked against the policy folder pattern and the folder's own listing, so no request can
  reach outside the output folder.
- Nothing is cached between requests, so results written during a run appear on refresh.

### Page (layout A)

```text
Run: dev / <run name> | Different (7) ▾ | ◀ ▶ (J/K)
┌──────────────────┬──────────────────────────────────────────────┐
│ 3C053A54…-1 13.9%│ [Side by side][Slider][Blink][diff.png]      │
│ 160C82CB…-1  2.4%│ Regions: 1 2 3 … 30                          │
│ …                │ ┌── NHI ─────────┐ ┌── MRP ─────────┐        │
│                  │ │ scroll + zoom  │ │ locked to NHI  │        │
│                  │ │ regions boxed  │ │                │        │
│                  │ └────────────────┘ └────────────────┘        │
│                  │ Region 3: − £137.63  + £137.62               │
└──────────────────┴──────────────────────────────────────────────┘
```

- **List:** a filter (different by default; different, not re-checked; identical; matching end points; failed; all),
  each entry showing the folder name, changed % and a marker for text changes or visual-only.
  - "Different" is every compared policy whose kind is `different`, as the full summary counts it, including policies
    whose NHI cover type was re-checked with Buildings & Contents. Those carry a "cover re-checked" marker and their
    re-check outcome (worded as the summary words it, for example "Matched MRP", and the cover type NHI had before).
  - "Different, not re-checked" leaves them out, matching `summarise differences` (`-Mode differences`).
  - Decided with the user: the default matches the full summary rather than `-Mode differences`. The selected policy is kept in the URL hash, so a
    refresh or a shared link reopens it.
- **Viewer:** both screenshots scaled to the pane width, scrolling and zooming together; region bounds (from
  `report.json`, which are in screenshot pixels, so scaled by the displayed width over the screenshot's width) drawn as outlines on both. Clicking a region number scrolls to it and shows
  its text change below. Slider and blink overlay MRP on NHI at the same scale; `diff.png` replaces both.
- **Details:** end points, size difference, answer changes, and the endorsement-order note when set.
- **Failed policies:** the failure screenshot(s) and the issues from `result.json`, instead of the comparison.
- Images load only for the selected policy.

## Left to the builder

- Where the page's static files live and how they reach `dist/`.
- The exact JSON shapes of the two API routes, as long as they carry the fields above.
- How the browser is opened on Windows and elsewhere (`start`, `open`, `xdg-open`), and the `--no-open` default in
  tests.
- Styling, within the project's existing plain look.
