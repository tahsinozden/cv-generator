#!/usr/bin/env node
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mdToPdf } from "md-to-pdf";
import {
  CSS_PATH,
  DATA_DIR,
  ROLES,
  buildHtml,
  composeMarkdownDocument,
  embedPdfMetadata,
  findPhoto,
  roleMetadata,
  roleMdName,
  rolePdfName,
} from "./cv-lib.mjs";

const args = process.argv.slice(2);
const watch = args.includes("--watch") || args.includes("-w");
const help = args.includes("--help") || args.includes("-h");
const noPhoto = args.includes("--no-photo");
const listRoles = args.includes("--list-roles");

function getArgValue(name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}
const photoArg = getArgValue("--photo");
const roleArg = getArgValue("--role");

const USAGE = `
CV generator — converts the Markdown CV (base.md + a role overlay) into a
styled PDF via md-to-pdf. Three variants are supported: full, lead,
staff. The shared content lives in data/base.md; the role-specific headline
title, Summary and Core Skills / Key Achievements live in data/roles/<role>.md.

Usage:
  node generate.mjs [options]

Options:
  --role <key>        Build a single variant (full | lead | staff).
                      If omitted, all variants are built.
  --list-roles        List the available role variants and exit.
  -w, --watch         Re-run when the base, the role overlay, or the CSS
                      changes. Watches the variant selected by --role (or
                      the full variant by default).
  --photo <path>      Path to a profile photo to embed in the header.
  --no-photo          Disable photo embedding.
  -h, --help          Show this help.

Outputs:
  data/CV.pdf          — full variant (canonical name)
  data/CV.md           — full variant markdown (canonical name)
  data/CV_v1.pdf       — staff variant (opaque code v1)
  data/CV_v1.md        — staff variant markdown
  data/CV_v2.pdf       — lead variant (opaque code v2)
  data/CV_v2.md        — lead variant markdown
`;

if (help) {
  console.log(USAGE);
  process.exit(0);
}

if (listRoles) {
  for (const key of Object.keys(ROLES)) {
    console.log(`${key.padEnd(8)} -> ${ROLES[key].pdf} | ${ROLES[key].md}`);
  }
  process.exit(0);
}

function resolveRoles() {
  if (roleArg) {
    if (!ROLES[roleArg]) {
      console.error(`Unknown role: ${roleArg}`);
      console.error(`Available roles: ${Object.keys(ROLES).join(", ")}`);
      process.exit(1);
    }
    return [roleArg];
  }
  return Object.keys(ROLES);
}

async function renderRole(roleKey) {
  if (!existsSync(CSS_PATH)) {
    console.error(`Stylesheet not found: ${CSS_PATH}`);
    process.exit(1);
  }

  const photoPath = findPhoto(DATA_DIR, { noPhoto, photoArg });
  const outPath = join(DATA_DIR, rolePdfName(roleKey));
  const mdPath = join(DATA_DIR, roleMdName(roleKey));
  const metadata = roleMetadata(roleKey);

  console.log(`Role  : ${roleKey}`);
  console.log(`Title : ${metadata.subject}`);
  console.log(`PDF   : ${outPath}`);
  console.log(`MD    : ${mdPath}`);
  console.log(`Photo : ${photoPath || "(none)"}`);

  const { html: content } = buildHtml(roleKey, photoPath);

  await writeFile(mdPath, composeMarkdownDocument(roleKey));

  const result = await mdToPdf(
    { content },
    {
      document_title: metadata.title,
      stylesheet: [CSS_PATH],
      basedir: DATA_DIR,
      page_media_type: "print",
      pdf_options: {
        printBackground: true,
        format: "A4",
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      },
      launch_options: {
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: true,
      },
    },
  );

  let writtenPath = outPath;
  if (result && result.filename) {
    writtenPath = result.filename;
  } else if (result && result.content) {
    await writeFile(outPath, result.content);
  } else {
    console.error("Conversion failed.", result);
    process.exit(1);
  }

  console.log(`Done  : ${writtenPath}`);
  await embedPdfMetadata(writtenPath, metadata);
  console.log(`Meta  : title, author, subject, keywords embedded`);
  console.log("");
  return writtenPath;
}

async function main() {
  const roles = resolveRoles();
  console.log(`Building ${roles.length} variant${roles.length === 1 ? "" : "s"}...\n`);
  for (const roleKey of roles) {
    await renderRole(roleKey);
  }

  if (watch) {
    const watchRole = roleArg || "full";
    if (!ROLES[watchRole]) {
      console.error(`Unknown role for --watch: ${watchRole}`);
      process.exit(1);
    }
    const { watch: fsWatch } = await import("node:fs");
    const { roleOverlayPath, BASE_MD } = await import("./cv-lib.mjs");
    console.log(`Watching for changes (--role ${watchRole})... (Ctrl+C to stop)`);
    let running = false;
    const targets = [BASE_MD, roleOverlayPath(watchRole), CSS_PATH];
    if (photoArg) targets.push(resolve(photoArg));
    for (const target of targets) {
      if (!existsSync(target)) continue;
      fsWatch(target, { persistent: true }, async () => {
        if (running) return;
        running = true;
        try {
          console.log(`\nChange detected in ${basename(target)} — regenerating ${watchRole}...`);
          await renderRole(watchRole);
        } finally {
          running = false;
        }
      });
    }
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
