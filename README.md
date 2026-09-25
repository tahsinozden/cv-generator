# CV Generator

Generate a styled PDF resume/CV from Markdown using [`md-to-pdf`] (headless
Chromium). One shared source file plus per-role overlays produces multiple
role-tuned variants, each emitted as a styled PDF and a standalone,
ATS-friendly Markdown document.

[`md-to-pdf`]: https://github.com/simonhaenisch/md-to-pdf

## Features

- Write your CV once in Markdown (`data/base.md`).
- Produce three role-tuned variants (`full`, `lead`, `staff`) from a single
  shared source.
- Each variant emits both a styled PDF and a standalone Markdown document.
- Embeds PDF metadata (title, author, subject, keywords) for ATS tools.
- Semantic header with schema.org `Person` microdata.
- Optional profile photo.

## Quick start

```bash
npm install
npm run build                 # build all 3 variants (PDFs + Markdown)
npm test                      # structural + visual regression tests
```

PDFs and Markdown files are written to `data/`:

| Variant | Code | PDF          | Markdown |
|---------|------|--------------|----------|
| `full`  | (canonical) | `CV.pdf` | `CV.md`  |
| `lead`  | `v2`  | `CV_v2.pdf`  | `CV_v2.md` |
| `staff` | `v1`  | `CV_v1.pdf`  | `CV_v1.md` |

## Customize it for you

The repository ships with placeholder example content (`Jane Doe`). Replace it
with your own details before publishing.

1. **Your name** — edit `CV_NAME` in `src/cv-lib.mjs`. This drives the H1
   heading and the PDF metadata author. The output filenames are defined in the
   same file, under `ROLES` (e.g. `CV.pdf`, `CV_v1.pdf`, `CV_v2.pdf`).
2. **Contact info & content** — edit `data/base.md`:
   - The contact block at the top (nationality, phone, email, website,
     LinkedIn, address).
   - `## Work Experience`, `## Education & Training`, `## Language Skills`,
     `## Honors and Awards`, `## Certifications`.
3. **Role overlays** — edit `data/roles/full.md`, `data/roles/lead.md`, and
   `data/roles/staff.md` for the per-role Summary, Core Skills, and Key
   Achievements.
4. **Profile photo** — a neutral placeholder avatar ships at
   `data/CV_photo.png`. Replace it with your own image named `CV_photo.jpg`
   (or `cv_photo.jpg`, `photo.jpg`, `CV_photo.png`) in `data/`, or pass
   `--photo <path>`. Omit it to render a photo-less header (or use
   `--no-photo`). The header works with or without a photo.
5. **Styling** — edit `src/cv-style.css`.

> The name and output filenames are intentionally hardcoded in
> `src/cv-lib.mjs` rather than read from a config file. Don't forget to update
> `CV_NAME` — otherwise the generated PDF ships with the placeholder name.

## Variant profiles

| Variant | Target                | Sections dropped  | Extra processing |
|---------|-----------------------|-------------------|------------------|
| `full`  | Unabridged master     | —                 | —                |
| `lead`  | Leadership-focused    | —                 | Strips stack lines, trims bullets, collapses early career |
| `staff` | Staff/architect-focused | Honors and Awards | Strips stack lines, trims bullets, collapses early career |

## Source layout

```
data/
  base.md          # shared content: contacts, Work Experience, Education,
                   #   Languages, Honors, Skills, Certifications
  roles/
    full.md        # per-variant overlay: Summary, Core Skills, Key Achievements
    lead.md
    staff.md
  CV_photo.jpg     # optional shared profile photo

src/
  generate.mjs     # build entry point (watch mode, single-variant builds)
  cv-lib.mjs       # composition, metadata, HTML generation (ROLES, composeMarkdown, buildHtml)
  cv-style.css     # PDF styling (applied by md-to-pdf)
  cv.test.mjs      # structural and visual regression tests
```

## CLI

```bash
node src/generate.mjs --help        # full usage
node src/generate.mjs --role staff  # build a single variant
node src/generate.mjs --list-roles  # list available variants
node src/generate.mjs --watch       # live-rebuild on changes
node src/generate.mjs --no-photo    # build without a photo
```

Or via the `Makefile`:

```bash
make build                # build all variants
make build-role ROLE=lead # build a single variant
make watch                # rebuild the full variant on changes
make clean                # remove generated PDFs and Markdown
```

## Tests

```bash
npm test                   # run the full suite
node --test src/cv.test.mjs --test-name-pattern="composeMarkdown"  # run a subset
```

The suite covers structural composition and a visual regression snapshot
against `test/baseline/cv-screenshot.png`. If the baseline is missing, the
first test run writes it; delete it to regenerate from the current output.

## License

MIT
