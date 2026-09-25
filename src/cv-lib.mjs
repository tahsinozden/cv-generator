import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(join(__dirname, ".."));
export const DATA_DIR = join(ROOT, "data");
export const CSS_PATH = join(__dirname, "cv-style.css");
export const BASE_MD = join(DATA_DIR, "base.md");

export const CV_NAME = "Jane Doe";

/**
 * The three CV variants. The `full` variant preserves the unabridged CV and
 * keeps the canonical PDF filename so the existing release URL keeps working.
 * The `lead` and `staff` overlays tune the headline title, the
 * Summary and Core Skills / Key Achievements sections for the target role
 * while sharing everything else from base.md.
 */
export const ROLES = {
  full: {
    overlay: "roles/full.md",
    code: "",
    pdf: "CV.pdf",
    md: "CV.md",
    exclude: [],
  },
  lead: {
    overlay: "roles/lead.md",
    code: "v2",
    pdf: "CV_v2.pdf",
    md: "CV_v2.md",
    exclude: [],
    compact: { firstNFull: 2 },
  },
  staff: {
    overlay: "roles/staff.md",
    code: "v1",
    pdf: "CV_v1.pdf",
    md: "CV_v1.md",
    exclude: ["Honors and Awards"],
    compact: { firstNFull: 2 },
  },
};

export const DEFAULT_ROLE = "full";

/** Shared ATS keywords — every variant inherits these. */
export const SHARED_KEYWORDS = [
  "Software Engineer",
  "Java",
  "Python",
  "TypeScript",
  "Spring Boot",
  "Kubernetes",
  "REST",
  "Microservices",
  "PostgreSQL",
  "MySQL",
  "Docker",
  "React",
  "Full-Stack",
  "San Francisco",
  "USA",
];

export function roleOverlayPath(roleKey) {
  const role = ROLES[roleKey];
  if (!role) throw new Error(`Unknown role: ${roleKey}`);
  return join(DATA_DIR, role.overlay);
}

export function rolePdfName(roleKey) {
  const role = ROLES[roleKey];
  if (!role) throw new Error(`Unknown role: ${roleKey}`);
  return role.pdf;
}

export function roleMdName(roleKey) {
  const role = ROLES[roleKey];
  if (!role) throw new Error(`Unknown role: ${roleKey}`);
  return role.md;
}

export function findPhoto(markdownDir, { noPhoto, photoArg } = {}) {
  if (noPhoto) return null;
  if (photoArg) {
    const p = resolve(photoArg);
    return existsSync(p) ? p : null;
  }
  const candidates = ["CV_photo.jpg", "cv_photo.jpg", "photo.jpg", "CV_photo.png"];
  for (const c of candidates) {
    const p = join(markdownDir, c);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Parse the contact info bullet list from raw markdown.
 * Returns an array of { label, value } pairs, e.g.
 *   { label: "Email", value: "jane.doe@example.com" }
 */
export function parseContactInfo(raw) {
  const lines = raw.split("\n");
  const contacts = [];
  for (const line of lines) {
    const m = line.match(/^\s*-\s+\*\*([^*]+):\*\*\s*(.+)$/);
    if (!m) continue;
    const label = m[1].trim();
    const value = m[2].trim();
    contacts.push({ label, value });
  }
  return contacts;
}

/**
 * Parse a role overlay file. The overlay starts with a tiny frontmatter block
 * delimited by `---` lines containing flat `key: value` fields (currently
 * `title`), followed by the role-specific markdown body (Summary
 * and, for tuned variants, a Highlights section).
 *
 * Returns { title, body }.
 */
export function parseRoleOverlay(overlayPath) {
  const raw = readFileSync(overlayPath, "utf8");
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fm) return { title: "", body: raw.trim() };

  const fields = fm[1];
  const body = fm[2].trim();
  let title = "";
  for (const line of fields.split(/\r?\n/)) {
    const m = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    if (m[1] === "title") title = m[2].trim();
  }
  return { title, body };
}

/**
 * Extract the most recent job title from base.md — the title of the first
 * `### <title> — <company>` entry in the Work Experience section. This is the
 * single source of truth for the header tagline and PDF metadata subject, so
 * every variant shows the actual current title and stays in sync with the
 * work history automatically.
 */
export function latestJobTitle(raw) {
  const m = raw.match(/^### (.+?)\s+—\s+.+$/m);
  return m ? m[1].trim() : "";
}

/**
 * Strip the header matter (H1, bold role line, contact bullet list and the
 * following horizontal rule) from a markdown source so only the body remains.
 * Used on base.md to obtain the shared content starting at the first section.
 */
export function stripContactBlock(raw) {
  let md = raw.replace(/^# .*\r?\n+/, "");
  md = md.replace(/^\*\*[^*\n]+\*\*\r?\n+/, "");
  md = md.replace(/^Polish citizen[^\n]*\r?\n+/i, "");
  md = md.replace(/^(?:-\s+\*\*[^*]+\*\*:?\s+.+\r?\n)+/, "");
  // The contact block is closed by a horizontal rule. After stripping the
  // bullets, leading blank lines may precede that rule — collapse them so the
  // anchored rule match succeeds and we don't leave a duplicate separator
  // behind when composeMarkdown adds its own joiner.
  md = md.replace(/^\s+/, "");
  md = md.replace(/^---\s*\r?\n+/, "");
  return md.trim();
}

/**
 * Wrap each `### ...` entry in a <section class="cv-entry"> container so that
 * individual jobs, education entries, etc. don't split across PDF pages.
 */
export function wrapEntries(md) {
  return md.replace(/(### .+?\n[\s\S]*?)(?=\n### |\n## |\n--- |$)/g,
    (match) => `<section class="cv-entry">\n\n${match.trim()}\n\n</section>\n`);
}

/**
 * Compose the full markdown body for a role by joining the role overlay
 * (title + Summary + optional Highlights) with the shared
 * base.md content (Work Experience onward). Contacts and the role title are
 * returned separately so the header can be rebuilt semantically.
 */
/**
 * Remove one or more `## <Section>` blocks from a markdown body. A block runs
 * from its heading to the next `## ` heading (or to the trailing `---` /
 * end of the body). Used to drop shared sections that a variant opts out of
 * (e.g. tuned variants exclude "Honors and Awards"). The data still lives in
 * base.md as the single source of truth.
 */
export function stripSections(md, sectionNames) {
  if (!sectionNames || sectionNames.length === 0) return md;
  let out = md;
  for (const name of sectionNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match "## <name>" through its trailing "---" separator (consuming it so
    // no orphaned rule is left behind). Falls back to end-of-string for a
    // trailing section with no separator.
    const re = new RegExp(
      `\\n?## ${escaped}\\s*\\r?\\n[\\s\\S]*?(?:\\n---\\s*\\r?\\n?|$)`
    );
    out = out.replace(re, "");
  }
  return out;
}

/**
 * Trim a markdown entry to at most `maxBullets` bullet lines. Non-bullet
 * lines (headings, date lines, text paragraphs) are always preserved.
 */
export function trimBullets(md, maxBullets) {
  const lines = md.split("\n");
  const result = [];
  let bulletCount = 0;

  for (const line of lines) {
    if (/^\s*-\s/.test(line)) {
      if (bulletCount >= maxBullets) continue;
      bulletCount++;
    }
    result.push(line);
  }

  return result.join("\n");
}

/**
 * Compact the Work Experience section for a 2-page CV:
 * - Strip all **Stack:** lines
 * - Trim bullets to 2 for the first 2 (most recent) entries, 1 for the rest
 * - Collapse the last 3 entries into a single "Early Career" summary
 */
export function compactWorkExperience(md, options = {}) {
  const { firstNFull = 0 } = options;

  const weIdx = md.indexOf("## Work Experience");
  if (weIdx === -1) return md;

  const prefix = md.slice(0, weIdx);

  const header = "## Work Experience\n\n";
  const afterHeader = md.slice(weIdx + header.length);

  const nextSectionMatch = afterHeader.match(/\n## /);
  const weBody = nextSectionMatch
    ? afterHeader.slice(0, nextSectionMatch.index)
    : afterHeader;
  const suffix = nextSectionMatch
    ? afterHeader.slice(nextSectionMatch.index)
    : "";

  const rawBlocks = weBody.split("\n\n### ");
  const entries = rawBlocks.map((block, i) => (i === 0 ? block : "### " + block));

  const trimmed = entries.map((entry, i) => {
    const isFullEntry = i < firstNFull;

    let cleaned = entry
      .replace(/\n\*\*Stack:\*\*[^\n]*\n?/g, "\n")
      .trimEnd();

    const maxBullets = isFullEntry ? Infinity : 1;
    cleaned = trimBullets(cleaned, maxBullets);
    return cleaned;
  });

  const EARLY_CAREER_COUNT = 3;
  if (trimmed.length > EARLY_CAREER_COUNT + 1) {
    const collapsed = trimmed.splice(
      trimmed.length - EARLY_CAREER_COUNT,
      EARLY_CAREER_COUNT
    );
    trimmed.push(buildEarlyCareerEntry(collapsed));
  }

  return prefix + header + trimmed.join("\n\n") + suffix;
}

/**
 * Collapse the given entries (each `### Title — Company` + date line + one
 * bullet) into a single "Early Career" entry with one bullet per collapsed
 * role, deriving the summary from the entries' own content.
 */
function buildEarlyCareerEntry(entries) {
  const meta = entries.map((entry) => {
    const heading = entry.match(/^###\s+(.+?)\s+—\s+(.+)$/m);
    const title = heading ? heading[1].trim() : "";
    const company = heading ? heading[2].trim() : "";
    const date = entry.match(/^\*([^*]+)\*/m);
    const dateText = date ? date[1].split("|")[0].trim() : "";
    const bullet = entry.match(/^-\s+([\s\S]+?)(?=\n-\s+|\n\n|$)/m);
    const bulletText = bullet ? bullet[1].trim() : "";
    return { company, title, date: dateText, bulletText };
  });

  const bullets = meta
    .filter((m) => m.company || m.title)
    .map((m) => {
      const who = [m.company, m.title].filter(Boolean).join(" — ");
      const when = m.date ? ` (${m.date})` : "";
      const what = m.bulletText ? `: ${m.bulletText}` : "";
      return `- **${who}${when}**${what}`;
    });

  const starts = meta.map((m) => m.date.split("–")[0].trim()).filter(Boolean);
  const ends = meta
    .map((m) => {
      const parts = m.date.split("–");
      return (parts[1] || parts[0]).trim();
    })
    .filter(Boolean);

  const range =
    starts.length && ends.length
      ? `*${starts[starts.length - 1]} – ${ends[0]}*`
      : "";

  return ["### Early Career", range, "", ...bullets].filter(Boolean).join("\n");
}

export function composeMarkdown(roleKey) {
  if (!ROLES[roleKey]) throw new Error(`Unknown role: ${roleKey}`);

  const baseRaw = readFileSync(BASE_MD, "utf8");
  const contacts = parseContactInfo(baseRaw);
  let baseBody = stripContactBlock(baseRaw);
  baseBody = stripSections(baseBody, ROLES[roleKey].exclude || []);

  const role = ROLES[roleKey];
  if (role.compact) {
    const opts = typeof role.compact === "object" ? role.compact : {};
    baseBody = compactWorkExperience(baseBody, opts);
  }

  const roleTitle = latestJobTitle(baseRaw);

  const overlay = parseRoleOverlay(roleOverlayPath(roleKey));
  const roleBody = overlay.body.trim();
  const body = roleBody ? `${roleBody}\n\n---\n\n${baseBody}` : baseBody;

  return { contacts, roleTitle, body };
}

/**
 * Compose a complete standalone Markdown document for a role: an H1 name, the
 * latest job title as a tagline, the contact bullet block (reconstructed from
 * base.md), a horizontal rule, and the composed body (role overlay + shared
 * base content). This is the plain-text counterpart of the styled PDF — an
 * ATS-friendly, copy-pasteable, GitHub-renderable version of the CV that is
 * generated and released alongside the PDFs.
 */
export function composeMarkdownDocument(roleKey) {
  const { contacts, body } = composeMarkdown(roleKey);
  const lines = [];
  lines.push(`# ${CV_NAME}`);
  lines.push("");
  for (const { label, value } of contacts) {
    lines.push(`- **${label}:** ${value}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(body);
  return lines.join("\n");
}

/**
 * Build a semantic <address> block for contact info with schema.org microdata.
 * URLs and emails are rendered as clickable <a href> links.
 */
function buildContactAddress(contacts) {
  if (contacts.length === 0) return "";
  const items = contacts.map(({ label, value }) => {
    const itemprop = contactItemprop(label);
    const linkedValue = linkifyValue(label, value);
    return `<span class="cv-contact-item" itemprop="${itemprop}"><span class="cv-contact-label">${label}:</span> <span class="cv-contact-value">${linkedValue}</span></span>`;
  }).join("\n    ");
  return `<address class="cv-contact" itemprop="address">
    ${items}
  </address>`;
}

function linkifyValue(label, value) {
  const l = label.toLowerCase();
  if (l === "email") {
    return `<a href="mailto:${value}" itemprop="email">${value}</a>`;
  }
  if (l === "website" || l === "linkedin") {
    const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return `<a href="${url}" itemprop="url">${value}</a>`;
  }
  return value;
}

function contactItemprop(label) {
  const l = label.toLowerCase();
  if (l === "email") return "email";
  if (l === "phone") return "telephone";
  if (l === "website") return "url";
  if (l === "linkedin") return "sameAs";
  if (l === "address") return "streetAddress";
  if (l === "nationality") return "nationality";
  return "contactPoint";
}

export function buildHeader(photoPath, markdownDir, contacts = [], roleTitle = "", roleKey = "") {
  const photoRel = photoPath
    ? `<div class="cv-photo-frame"><img class="cv-photo" src="${relative(markdownDir, photoPath)}" alt="${CV_NAME}" itemprop="image" /></div>`
    : "";

  const contactHtml = buildContactAddress(contacts);

  const variantAttr = roleKey ? ` data-variant="${roleKey}"` : "";

  return `<div class="cv-header"${variantAttr} itemscope itemtype="https://schema.org/Person">
  ${photoRel}
  <div class="cv-header-text">
    <h1 class="cv-name" itemprop="name">${CV_NAME}</h1>
    ${contactHtml}
  </div>
</div>
`;
}

/**
 * Build the full HTML for a given role: a semantic header (photo, name, role
 * tagline, contact address) followed by the composed markdown body.
 */
export function buildHtml(roleKey, photoPathOverride) {
  const markdownDir = DATA_DIR;
  const photoPath = photoPathOverride !== undefined
    ? photoPathOverride
    : findPhoto(markdownDir);
  const { contacts, roleTitle, body } = composeMarkdown(roleKey);
  const md = wrapEntries(body);
  const headerHtml = buildHeader(photoPath, markdownDir, contacts, roleTitle, roleKey);
  return { html: headerHtml + "\n" + md, photoPath, markdownDir, contacts, roleTitle };
}

/**
 * Build role-aware PDF metadata. The subject and keywords reflect the target
 * role title; shared ATS skill keywords are inherited by every variant.
 */
export function roleMetadata(roleKey) {
  if (!ROLES[roleKey]) throw new Error(`Unknown role: ${roleKey}`);
  const baseRaw = readFileSync(BASE_MD, "utf8");
  const title = latestJobTitle(baseRaw) || "Software Engineer";
  const keywords = [title, ...SHARED_KEYWORDS.filter((k) => k !== title)];
  return {
    title: `${CV_NAME} — CV`,
    author: CV_NAME,
    subject: `${title} — Curriculum Vitae`,
    keywords: keywords.join(", "),
    creator: "CV Generator (md-to-pdf)",
  };
}

/** Backwards-compatible default metadata (the full variant). */
export const CV_METADATA = roleMetadata(DEFAULT_ROLE);

/**
 * Post-process a generated PDF to embed document metadata (title, author,
 * subject, keywords) that screening tools and document management systems
 * can read. Writes the modified PDF back to the same path.
 */
export async function embedPdfMetadata(pdfPath, metadata = CV_METADATA) {
  const pdfBytes = readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);

  pdfDoc.setTitle(metadata.title);
  pdfDoc.setAuthor(metadata.author);
  pdfDoc.setSubject(metadata.subject);
  pdfDoc.setKeywords([metadata.keywords]);
  pdfDoc.setCreator(metadata.creator);
  pdfDoc.setProducer(metadata.creator);
  pdfDoc.setCreationDate(new Date());
  pdfDoc.setModificationDate(new Date());

  const modifiedBytes = await pdfDoc.save();
  await writeFile(pdfPath, modifiedBytes);
  return pdfDoc;
}
