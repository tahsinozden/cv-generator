# Quickstart

Generate styled PDF CVs from Markdown.

## Prerequisites

- Node.js 18+ (tested on 22.x)
- npm (bundled with Node)

No system packages are required; `md-to-pdf` drives headless Chromium via
`puppeteer`, which installs its own browser.

## Setup

```bash
npm install
```

## Build

```bash
npm run build                        # build all 3 variants (full, lead, staff)
npm run build -- --role staff        # build one variant (full | lead | staff)
npm run build -- --list-roles        # list available variants
npm run watch -- --role lead         # auto-regenerate one variant on changes
```

Output (PDF + Markdown) is written to `data/`:

- `data/CV.pdf` / `data/CV.md`
- `data/CV_v1.pdf` / `data/CV_v1.md` (staff)
- `data/CV_v2.pdf` / `data/CV_v2.md` (lead)

## Test

```bash
npm test
```

Run a subset of tests by name:

```bash
node --test src/cv.test.mjs --test-name-pattern="composeMarkdown"
```

The visual-regression test writes its baseline to
`test/baseline/cv-screenshot.png` on first run. Delete that file and re-run to
regenerate it after changing the layout or content.

## Customize

1. `CV_NAME` in `src/cv-lib.mjs` — your name (drives H1 + PDF author metadata).
2. Output filenames under `ROLES` in `src/cv-lib.mjs`.
3. Contact block and all sections in `data/base.md`.
4. Per-role Summary / Core Skills / Key Achievements in `data/roles/*.md`.
5. Optional photo: a neutral placeholder ships at `data/CV_photo.png`; replace
   it with your own image (`data/CV_photo.jpg` or `--photo <path>`), or omit
   for a photo-less header.

## Clean

```bash
make clean        # remove generated PDFs and Markdown
```
