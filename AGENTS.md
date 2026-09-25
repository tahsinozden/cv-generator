# AGENTS.md

## Build & Test

```bash
npm install                          # install dependencies
npm run build                        # generate all 3 variants (PDFs + Markdown) from base.md + role overlays
npm run build -- --role staff        # generate a single variant (full|lead|staff)
npm run build -- --list-roles        # list available variants
npm run watch -- --role lead         # watch mode for one variant — auto-regenerate on changes
npm test                             # run tests (structural + visual regression)
```

## Lint

No linter is configured in this project.

## Project Overview

Generates styled PDF CVs from Markdown using `md-to-pdf` (headless Chromium).
Three role-tuned variants (`full`, `lead`, `staff`) are produced from a
single shared source to keep maintenance cheap:

- `data/base.md` — shared content (contacts, Work Experience, Education,
  Languages, Honors, Skills, Certifications). The single source of truth for
  everything that is identical across roles.
- `data/roles/<role>.md` — per-variant overlay with the role-specific
  Summary, Core Skills, and Key Achievements sections. The
  PDF metadata title is derived automatically from the latest (first)
  `### <title> — <company>` entry in `base.md`, so every variant stays in
  sync with the work history without any per-role title field. The header
  itself renders only the name, photo and contacts — no role tagline.
- `data/CV_photo.png` — neutral placeholder profile photo shipped with the
  template; users replace it with their own image (`CV_photo.jpg` or similar).
- Styling lives in `src/cv-style.css`. The main entry point is `src/generate.mjs`;
  composition/metadata logic lives in `src/cv-lib.mjs` (`ROLES`, `composeMarkdown`,
  `composeMarkdownDocument`, `parseRoleOverlay`, `roleMetadata`, `buildHtml`). The
  `full` variant keeps the canonical output names `CV.pdf` / `CV.md`; the tuned
  variants ship under opaque version codes — `v1` = staff, `v2` = lead — so a
  recruiter-facing filename never reveals which role variant it is. The files
  are `CV_<code>.pdf` / `CV_<code>.md`. Each variant emits a standalone Markdown
  document (`composeMarkdownDocument`) alongside the styled PDF — an
  ATS-friendly, GitHub-renderable counterpart released with the PDFs.

## Customization

The repo ships with placeholder example content (`Jane Doe`). When adapting it
for a real person, edit `CV_NAME` and the output filenames in `src/cv-lib.mjs`,
the contact block and sections in `data/base.md`, and the per-role overlays in
`data/roles/`.

## Workflow Rules

- **Test-Driven Development (TDD) is mandatory.** Every new feature or bug fix starts with a failing test that defines the expected behavior. Only then implement the code that makes it pass.
  1. Write a failing test
  2. Run `npm test` to confirm it fails for the right reason
  3. Implement the minimal change to make it pass
  4. Run `npm test` again to confirm green
- **No shortcuts. No hacks.** Implement things the right way — proper semantics, clean abstractions, no negative-margin layout tricks, no `display: none` to hide information, no copy-pasted code blocks.
- **Every feature must have test coverage.** If you add or change behavior, add or update the corresponding test in `src/cv.test.mjs` before considering the work done.
- **Regenerate CVs after every change.** After any edit to `base.md`, role overlays, CSS, or generation logic, run `npm run build` to regenerate all 3 variants so the output files always reflect the latest state.
- **Update documentation after structural changes.** After any change that affects the project structure, variant configuration, build process, or role definitions, update `README.md` and `AGENTS.md` to stay in sync.
- **Never fabricate data.** The `full` variant (`data/roles/full.md` + `data/base.md`) is the single source of truth for all CV content. When enriching or expanding any role overlay or work-experience entry, derive additions only from technologies already listed in the corresponding Stack line and responsibilities already described in the existing bullets. Do not invent achievements, metrics, architectural patterns, or responsibilities that are not already stated in the source files.
