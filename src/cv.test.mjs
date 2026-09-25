import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import puppeteer from "puppeteer";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { PDFDocument } from "pdf-lib";
import {
  BASE_MD,
  ROLES,
  DEFAULT_ROLE,
  buildHtml,
  composeMarkdown,
  composeMarkdownDocument,
  latestJobTitle,
  parseRoleOverlay,
  roleMetadata,
  roleMdName,
  stripContactBlock,
  CV_METADATA,
  CSS_PATH,
  embedPdfMetadata,
  findPhoto,
  parseContactInfo,
  compactWorkExperience,
  trimBullets,
} from "./cv-lib.mjs";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const DATA_DIR = join(__dirname, "..", "data");
const BASELINE_DIR = join(__dirname, "..", "test", "baseline");
const OUTPUT_DIR = join(__dirname, "..", "test", "output");

const BASELINE_SCREENSHOT = join(BASELINE_DIR, "cv-screenshot.png");
const ACTUAL_SCREENSHOT = join(OUTPUT_DIR, "cv-screenshot.png");
const DIFF_SCREENSHOT = join(OUTPUT_DIR, "cv-diff.png");

const photoPath = findPhoto(DATA_DIR);
const ROLE_KEYS = Object.keys(ROLES);

function stripMetadataPng(buffer) {
  const png = PNG.sync.read(buffer);
  const stripped = new Uint8Array(png.width * png.height * 4);
  stripped.set(png.data);
  return { width: png.width, height: png.height, data: Buffer.from(stripped), buffer };
}

async function captureFullPage(html, stylesheetPath, viewportOptions = {}) {
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
  });
  try {
    const page = await browser.newPage();

    await page.setViewport({
      width: 794,
      height: 1123,
      deviceScaleFactor: 2,
      ...viewportOptions,
    });

    const css = readFileSync(stylesheetPath, "utf8");

    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.addStyleTag({ content: css });

    const screenshot = await page.screenshot({ fullPage: true });

    return screenshot;
  } finally {
    await browser.close();
  }
}

describe("CV Generator", () => {
  before(() => {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    mkdirSync(BASELINE_DIR, { recursive: true });
  });

  describe("Role configuration", () => {
    it("defines the three CV variants", () => {
      assert.deepEqual(
        ROLE_KEYS.sort(),
        ["full", "lead", "staff"],
        "ROLES should define full, lead, staff variants"
      );
    });

    it("every role has an overlay file and a pdf output name", () => {
      for (const key of ROLE_KEYS) {
        const role = ROLES[key];
        assert.ok(role.overlay, `${key} should have an overlay path`);
        assert.ok(role.pdf, `${key} should have a pdf output name`);
        assert.ok(
          existsSync(join(DATA_DIR, role.overlay)),
          `${key} overlay file should exist at ${role.overlay}`
        );
      }
    });

    it("the full variant preserves the canonical PDF filename", () => {
      assert.strictEqual(
        ROLES.full.pdf,
        "CV.pdf",
        "full variant must keep the canonical CV.pdf name"
      );
    });

    it("every role has a markdown output name mirroring its PDF name", () => {
      for (const key of ROLE_KEYS) {
        const role = ROLES[key];
        assert.ok(role.md, `${key} should have an md output name`);
        assert.ok(
          role.md.endsWith(".md"),
          `${key} md output name should use the .md extension`
        );
      }
    });

    it("the full variant preserves the canonical MD filename", () => {
      assert.strictEqual(
        ROLES.full.md,
        "CV.md",
        "full variant md should keep the canonical CV.md name"
      );
    });

    it("the full variant carries no opaque code (canonical name)", () => {
      assert.ok(ROLES.full.code === "", "full should use the empty code so its filename stays canonical");
    });

    it("tuned variants use opaque version codes, not role names, in their filenames", () => {
      for (const key of ["lead", "staff"]) {
        const role = ROLES[key];
        assert.ok(role.code, `${key}: should carry an opaque code`);
        assert.match(
          role.code,
          /^v\d+$/,
          `${key}: code should look like a neutral version tag (v1, v2, ...), got ${role.code}`
        );
        assert.ok(
          !/_Lead|_Staff/.test(role.pdf),
          `${key}: pdf filename must not leak the role name (got ${role.pdf})`
        );
        assert.ok(
          !/_Lead|_Staff/.test(role.md),
          `${key}: md filename must not leak the role name (got ${role.md})`
        );
      }
    });

    it("the code→role mapping is v1=staff, v2=lead", () => {
      assert.strictEqual(ROLES.staff.code, "v1");
      assert.strictEqual(ROLES.lead.code, "v2");
    });

    it("each role's pdf and md filenames derive from its code", () => {
      for (const key of ROLE_KEYS) {
        const { code } = ROLES[key];
        const suffix = code ? `_${code}` : "";
        assert.strictEqual(
          ROLES[key].pdf,
          `CV${suffix}.pdf`,
          `${key}: pdf should be CV${suffix}.pdf, got ${ROLES[key].pdf}`
        );
        assert.strictEqual(
          ROLES[key].md,
          `CV${suffix}.md`,
          `${key}: md should be CV${suffix}.md, got ${ROLES[key].md}`
        );
      }
    });

    it("staff excludes Honors and Awards; full and lead keep it", () => {
      for (const key of ROLE_KEYS) {
        const role = ROLES[key];
        assert.ok(Array.isArray(role.exclude), `${key} should declare an exclude list`);
      }
      assert.deepStrictEqual(ROLES.full.exclude, [], "full should exclude nothing");
      assert.deepStrictEqual(ROLES.lead.exclude, [], "lead should exclude nothing");
      assert.ok(
        ROLES.staff.exclude.includes("Honors and Awards"),
        "staff should exclude Honors and Awards"
      );
    });
  });

  describe("Role overlay parsing", () => {
    it("parseRoleOverlay exposes the overlay body (Summary + Core Skills + Key Achievements) for each role", () => {
      for (const key of ROLE_KEYS) {
        const overlay = parseRoleOverlay(join(DATA_DIR, ROLES[key].overlay));
        assert.ok(overlay.body, `${key} overlay should expose a body`);
        assert.ok(
          overlay.body.includes("Summary"),
          `${key} overlay body should contain the Summary section`
        );
      }
    });

    it("latestJobTitle extracts the most recent job title from base.md", () => {
      const raw = readFileSync(BASE_MD, "utf8");
      assert.strictEqual(
        latestJobTitle(raw),
        "Senior Software Engineer",
        "latestJobTitle should return the first (most recent) ### job title in Work Experience"
      );
    });

    it("every overlay includes Core Skills and Key Achievements sections", () => {
      for (const key of ROLE_KEYS) {
        const overlay = parseRoleOverlay(join(DATA_DIR, ROLES[key].overlay));
        assert.ok(
          overlay.body.includes("## Core Skills"),
          `${key} overlay should include a Core Skills section`
        );
        assert.ok(
          overlay.body.includes("## Key Achievements"),
          `${key} overlay should include a Key Achievements section`
        );
        assert.ok(
          !overlay.body.includes("## Highlights"),
          `${key} overlay should not keep the old Highlights section name`
        );
      }
    });

    it("overlays carry no unmeasurable percentage claims", () => {
      for (const key of ROLE_KEYS) {
        const overlay = parseRoleOverlay(join(DATA_DIR, ROLES[key].overlay));
        const claims = overlay.body.match(/[0-9]+%/g) ?? [];
        assert.deepStrictEqual(
          claims,
          [],
          `${key}: overlay should not contain unmeasurable percentage claims, found: ${claims.join(", ")}`
        );
      }
    });

    it("every Summary opens with the shared baseline", () => {
      for (const key of ROLE_KEYS) {
        const overlay = parseRoleOverlay(join(DATA_DIR, ROLES[key].overlay));
        const summaryStart = overlay.body.indexOf("## Summary");
        assert.ok(summaryStart > -1, `${key}: overlay should contain a Summary`);
        const summary = overlay.body.slice(summaryStart).split("\n").slice(2).join("\n").trimStart();
        assert.ok(
          summary.startsWith("Software engineer with several years of experience"),
          `${key}: Summary should open with the shared baseline, got: ${summary.slice(0, 80)}...`
        );
      }
    });
  });

  describe("Shared base content", () => {
    it("base.md contains the contact block and all shared sections", () => {
      const raw = readFileSync(BASE_MD, "utf8");
      const contacts = parseContactInfo(raw);
      assert.strictEqual(contacts.length, 6, "base.md should expose 6 contact entries");

      for (const section of [
        "Work Experience",
        "Education",
        "Language Skills",
        "Certifications",
      ]) {
        assert.ok(raw.includes(section), `base.md should contain the ${section} section`);
      }
    });

    it("base.md no longer carries a Job-Related Skills section (merged into per-role Core Skills)", () => {
      const raw = readFileSync(BASE_MD, "utf8");
      assert.ok(
        !raw.includes("## Job-Related Skills"),
        "Job-Related Skills should be removed from base.md — skills now live in each role's Core Skills"
      );
    });

    it("stripContactBlock removes the contact block and its closing horizontal rule", () => {
      const baseRaw = readFileSync(BASE_MD, "utf8");
      const body = stripContactBlock(baseRaw);
      assert.ok(
        !/^---/.test(body.trimStart()),
        "base body should not start with a horizontal rule — stripContactBlock must remove the contact block's closing rule"
      );
      assert.ok(
        body.startsWith("## Work Experience"),
        "base body should start with the first shared section (Work Experience)"
      );
    });
  });

  describe("Work Experience content", () => {
    it("base.md has 4 generic Work Experience entries", () => {
      const raw = readFileSync(BASE_MD, "utf8");
      const workIdx = raw.indexOf("## Work Experience");
      const eduIdx = raw.indexOf("## Education");
      const workSection = raw.slice(workIdx, eduIdx);
      const entries = workSection.match(/^### /gm) || [];
      assert.strictEqual(entries.length, 4, `expected 4 work entries, got ${entries.length}`);
    });
  });

  describe("Markdown composition (base + role overlay)", () => {
    it("composeMarkdown returns contacts, roleTitle and a body per role", () => {
      for (const key of ROLE_KEYS) {
        const composed = composeMarkdown(key);
        assert.strictEqual(composed.contacts.length, 6, `${key}: contacts come from base.md`);
        assert.ok(composed.roleTitle, `${key}: roleTitle should be set`);
        assert.ok(composed.body, `${key}: body should be set`);
      }
    });

    it("composeMarkdown prepends the role summary, core skills and key achievements before the shared work history", () => {
      for (const key of ROLE_KEYS) {
        const composed = composeMarkdown(key);
        const summaryIdx = composed.body.indexOf("Summary");
        const coreSkillsIdx = composed.body.indexOf("Core Skills");
        const achievementsIdx = composed.body.indexOf("Key Achievements");
        const experienceIdx = composed.body.indexOf("Work Experience");
        assert.ok(summaryIdx > -1, `${key}: composed body should contain Summary`);
        assert.ok(coreSkillsIdx > -1, `${key}: composed body should contain Core Skills`);
        assert.ok(achievementsIdx > -1, `${key}: composed body should contain Key Achievements`);
        assert.ok(experienceIdx > -1, `${key}: composed body should contain Work Experience`);
        assert.ok(summaryIdx < coreSkillsIdx, `${key}: summary should appear before core skills`);
        assert.ok(coreSkillsIdx < achievementsIdx, `${key}: core skills should appear before key achievements`);
        assert.ok(
          achievementsIdx < experienceIdx,
          `${key}: key achievements should appear before the shared work experience`
        );
      }
    });

    it("composeMarkdown emits exactly one separator between the role overlay and the shared body", () => {
      for (const key of ROLE_KEYS) {
        const { body } = composeMarkdown(key);
        assert.ok(
          !/\r?\n---\s*\r?\n+---\s*\r?\n/.test(body),
          `${key}: composed body must not contain adjacent horizontal rules (would render as two lines)`
        );
      }
    });

    it("composeMarkdown keeps the shared sections present in every variant", () => {
      for (const key of ROLE_KEYS) {
        const composed = composeMarkdown(key);
        for (const section of [
          "Work Experience",
          "Education",
          "Language Skills",
        ]) {
          assert.ok(
            composed.body.includes(section),
            `${key}: composed body should contain ${section}`
          );
        }
        // Certifications may be excluded by the compact variant
        if (!(ROLES[key].exclude || []).includes("Certifications")) {
          assert.ok(
            composed.body.includes("Certifications"),
            `${key}: composed body should contain Certifications`
          );
        }
        assert.ok(
          !composed.body.includes("## Job-Related Skills"),
          `${key}: composed body should not contain the removed Job-Related Skills section`
        );
      }
    });

    it("composeMarkdown drops Honors and Awards for tuned variants but keeps it in full", () => {
      for (const key of ROLE_KEYS) {
        const composed = composeMarkdown(key);
        if (ROLES[key].exclude.includes("Honors and Awards")) {
          assert.ok(
            !composed.body.includes("## Honors and Awards"),
            `${key}: should not contain the Honors and Awards section`
          );
          assert.ok(
            !composed.body.includes("Employee of the Quarter"),
            `${key}: excluded section content should not leak through`
          );
        } else {
          assert.ok(
            composed.body.includes("## Honors and Awards"),
            `${key}: should keep the Honors and Awards section`
          );
          assert.ok(
            composed.body.includes("Employee of the Quarter"),
            `${key}: Honors content should be present`
          );
        }
      }
    });

    it("composeMarkdown throws on an unknown role", () => {
      assert.throws(() => composeMarkdown("principal"), /Unknown role/);
    });
  });

  describe("Markdown document output", () => {
    it("roleMdName returns the md filename for each role", () => {
      for (const key of ROLE_KEYS) {
        assert.ok(roleMdName(key), `${key}: roleMdName should return a filename`);
        assert.strictEqual(roleMdName(key), ROLES[key].md);
      }
    });

    it("roleMdName throws on an unknown role", () => {
      assert.throws(() => roleMdName("principal"), /Unknown role/);
    });

    it("composeMarkdownDocument produces a standalone document starting with the name as H1", () => {
      for (const key of ROLE_KEYS) {
        const doc = composeMarkdownDocument(key);
        assert.ok(
          doc.startsWith("# Jane Doe"),
          `${key}: document should start with the name as an H1 heading`
        );
      }
    });

    it("composeMarkdownDocument does not render a job title tagline line under the H1", () => {
      for (const key of ROLE_KEYS) {
        const doc = composeMarkdownDocument(key);
        const lines = doc.split("\n");
        assert.strictEqual(lines[0], "# Jane Doe", `${key}: first line is the H1 name`);
        assert.notStrictEqual(
          lines[1],
          "Senior Software Engineer",
          `${key}: no job title tagline under the name`
        );
      }
    });

    it("composeMarkdownDocument reconstructs the contact bullet block in the original base.md format", () => {
      for (const key of ROLE_KEYS) {
        const doc = composeMarkdownDocument(key);
        assert.ok(doc.includes("- **Nationality:** American"), `${key}: should include Nationality bullet`);
        assert.ok(doc.includes("- **Phone:** (+1) 555-0100 (Mobile)"), `${key}: should include Phone bullet`);
        assert.ok(doc.includes("- **Email:** jane.doe@example.com"), `${key}: should include Email bullet`);
        assert.ok(doc.includes("- **Website:** https://jane-doe.example.com"), `${key}: should include Website bullet`);
        assert.ok(
          doc.includes("- **LinkedIn:** https://www.linkedin.com/in/jane-doe"),
          `${key}: should include LinkedIn bullet`
        );
        assert.ok(doc.includes("- **Address:** San Francisco, CA, USA"), `${key}: should include Address bullet`);
      }
    });

    it("composeMarkdownDocument places the composed body sections after the contact block in reading order", () => {
      for (const key of ROLE_KEYS) {
        const doc = composeMarkdownDocument(key);
        const contactIdx = doc.indexOf("- **Address:** San Francisco, CA, USA");
        const summaryIdx = doc.indexOf("## Summary");
        const coreSkillsIdx = doc.indexOf("## Core Skills");
        const achievementsIdx = doc.indexOf("## Key Achievements");
        const experienceIdx = doc.indexOf("## Work Experience");
        assert.ok(contactIdx > -1, `${key}: contact block present`);
        assert.ok(summaryIdx > -1, `${key}: summary present`);
        assert.ok(coreSkillsIdx > -1, `${key}: core skills present`);
        assert.ok(achievementsIdx > -1, `${key}: key achievements present`);
        assert.ok(experienceIdx > -1, `${key}: work experience present`);
        assert.ok(contactIdx < summaryIdx, `${key}: contacts before summary`);
        assert.ok(summaryIdx < coreSkillsIdx, `${key}: summary before core skills`);
        assert.ok(coreSkillsIdx < achievementsIdx, `${key}: core skills before achievements`);
        assert.ok(achievementsIdx < experienceIdx, `${key}: achievements before experience`);
      }
    });

    it("composeMarkdownDocument separates the contact block from the body with a horizontal rule", () => {
      for (const key of ROLE_KEYS) {
        const doc = composeMarkdownDocument(key);
        assert.ok(
          /\n---\n/.test(doc),
          `${key}: document should contain a horizontal rule separator between contacts and body`
        );
      }
    });

    it("composeMarkdownDocument drops Honors and Awards for tuned variants but keeps it in full", () => {
      for (const key of ROLE_KEYS) {
        const doc = composeMarkdownDocument(key);
        if (ROLES[key].exclude.includes("Honors and Awards")) {
          assert.ok(!doc.includes("## Honors and Awards"), `${key}: should not contain Honors`);
          assert.ok(!doc.includes("Employee of the Quarter"), `${key}: excluded content should not leak`);
        } else {
          assert.ok(doc.includes("## Honors and Awards"), `${key}: should contain Honors`);
          assert.ok(doc.includes("Employee of the Quarter"), `${key}: Honors content should be present`);
        }
      }
    });

    it("composeMarkdownDocument throws on an unknown role", () => {
      assert.throws(() => composeMarkdownDocument("principal"), /Unknown role/);
    });
  });

  describe("HTML structure per role", () => {
    it("builds HTML with the expected structural elements for every role", () => {
      for (const key of ROLE_KEYS) {
        const { html } = buildHtml(key, photoPath);

        assert.ok(html.includes("cv-header"), `${key}: should contain cv-header class`);
        if (photoPath) {
          assert.ok(html.includes("cv-photo-frame"), `${key}: should contain cv-photo-frame`);
        } else {
          assert.ok(!html.includes("cv-photo-frame"), `${key}: should omit cv-photo-frame without a photo`);
        }
        assert.ok(html.includes("cv-name"), `${key}: should contain cv-name`);
        assert.ok(html.includes("Jane Doe"), `${key}: should contain name`);

        assert.ok(html.includes("cv-entry"), `${key}: should contain cv-entry sections`);
        assert.ok(html.includes("Work Experience"), `${key}: should contain Work Experience`);
        assert.ok(html.includes("Education"), `${key}: should contain Education`);
        assert.ok(html.includes("Language Skills"), `${key}: should contain Language Skills`);
        assert.ok(html.includes("Core Skills"), `${key}: skills should come from the role's Core Skills section`);
        if (!(ROLES[key].exclude || []).includes("Certifications")) {
          assert.ok(html.includes("Certifications"), `${key}: should contain Certifications`);
        }
        assert.ok(
          !html.includes("Job-Related Skills"),
          `${key}: should not contain the removed Job-Related Skills section`
        );
      }
    });

    it("renders exactly one h1 per role", () => {
      for (const key of ROLE_KEYS) {
        const { html } = buildHtml(key, photoPath);
        const h1Count = (html.match(/<h1[ >]/g) || []).length;
        assert.strictEqual(h1Count, 1, `${key}: should have exactly one h1`);
      }
    });

    it("wraps ### entries in cv-entry containers for every role", () => {
      for (const key of ROLE_KEYS) {
        const { html } = buildHtml(key, photoPath);
        const entryCount = (html.match(/<section class="cv-entry">/g) || []).length;
        assert.ok(entryCount >= 5, `${key}: should have at least 5 cv-entry sections, got ${entryCount}`);
      }
    });
  });

  describe("Role tagline in header", () => {
    it("does not render a job title tagline in the header for any role", () => {
      for (const key of ROLE_KEYS) {
        const { html } = buildHtml(key, photoPath);
        assert.ok(
          !html.includes('class="cv-tagline"'),
          `${key}: header should not contain a cv-tagline element`
        );
        assert.ok(
          !html.includes('itemprop="jobTitle"'),
          `${key}: header should not carry the jobTitle itemprop`
        );
      }
    });
  });

  describe("Header layout", () => {
    it("spans the full header width when no photo is present", async () => {
      const { html } = buildHtml(DEFAULT_ROLE, null);
      const css = readFileSync(CSS_PATH, "utf8");
      const browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: true,
      });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle0" });
        await page.addStyleTag({ content: css });
        const geo = await page.evaluate(() => {
          const h = document.querySelector(".cv-header").getBoundingClientRect();
          const t = document.querySelector(".cv-header-text").getBoundingClientRect();
          return { headerW: h.width, textW: t.width };
        });
        assert.ok(
          geo.textW > geo.headerW * 0.7,
          `header text should span the header width without a photo (got ${geo.textW.toFixed(0)}px of ${geo.headerW.toFixed(0)}px)`
        );
      } finally {
        await browser.close();
      }
    });

    it("sits the photo left of the header text and vertically centers it", async () => {
      const { html } = buildHtml(DEFAULT_ROLE, photoPath);
      const css = readFileSync(CSS_PATH, "utf8");
      const browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: true,
      });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle0" });
        await page.addStyleTag({ content: css });
        const geo = await page.evaluate(() => {
          const f = document.querySelector(".cv-photo-frame").getBoundingClientRect();
          const t = document.querySelector(".cv-header-text").getBoundingClientRect();
          return {
            frameRight: f.right,
            textX: t.x,
            frameCenterY: f.y + f.height / 2,
            textCenterY: t.y + t.height / 2,
          };
        });
        assert.ok(geo.frameRight < geo.textX, "photo should sit left of the header text");
        assert.ok(
          Math.abs(geo.frameCenterY - geo.textCenterY) < 2,
          `photo and text should be vertically centered (delta ${Math.abs(geo.frameCenterY - geo.textCenterY).toFixed(1)}px)`
        );
      } finally {
        await browser.close();
      }
    });
  });

  describe("Contact info in semantic <address>", () => {
    it("embeds contact info in a semantic <address> element inside the header", () => {
      const { html } = buildHtml(DEFAULT_ROLE, photoPath);
      assert.ok(html.includes("<address"), "should contain <address> element");
      assert.ok(html.includes("cv-contact"), "should contain cv-contact class");
      assert.ok(html.includes("cv-contact-item"), "should contain cv-contact-item class");
      assert.ok(html.includes("jane.doe@example.com"), "should contain email");
      assert.ok(html.includes("San Francisco"), "should contain address city");
    });

    it("does not leave a stray contact bullet list after the header", () => {
      const { html } = buildHtml(DEFAULT_ROLE, photoPath);
      const headerEnd = html.indexOf("</div>\n\n---");
      const bodyStart = headerEnd > -1 ? html.indexOf("---", headerEnd) : -1;
      const body = bodyStart > -1 ? html.slice(bodyStart) : "";
      assert.ok(!body.includes("**Nationality:**"), "contact bullets should not appear in body");
    });
  });

  describe("Contact parsing", () => {
    it("parseContactInfo extracts all contact entries from base.md", () => {
      const raw = readFileSync(BASE_MD, "utf8");
      const contacts = parseContactInfo(raw);
      const labels = contacts.map((c) => c.label);
      assert.ok(labels.includes("Nationality"), "should extract Nationality");
      assert.ok(labels.includes("Phone"), "should extract Phone");
      assert.ok(labels.includes("Email"), "should extract Email");
      assert.ok(labels.includes("Website"), "should extract Website");
      assert.ok(labels.includes("LinkedIn"), "should extract LinkedIn");
      assert.ok(labels.includes("Address"), "should extract Address");
      assert.strictEqual(contacts.length, 6, "should extract exactly 6 contact entries");
    });

    it("parseContactInfo returns label/value pairs with correct values", () => {
      const raw = readFileSync(BASE_MD, "utf8");
      const contacts = parseContactInfo(raw);
      const email = contacts.find((c) => c.label === "Email");
      assert.ok(email, "should have Email entry");
      assert.strictEqual(email.value, "jane.doe@example.com");
    });
  });

  describe("Schema.org microdata", () => {
    it("includes schema.org Person microdata attributes for LLM parsability", () => {
      const { html } = buildHtml(DEFAULT_ROLE, photoPath);
      assert.ok(html.includes("itemscope"), "should contain itemscope");
      assert.ok(html.includes('itemtype="https://schema.org/Person"'), "should contain schema.org Person type");
      assert.ok(html.includes('itemprop="name"'), "should contain name itemprop");
      assert.ok(html.includes('itemprop="email"'), "should contain email itemprop");
      assert.ok(html.includes('itemprop="telephone"'), "should contain telephone itemprop");
      assert.ok(html.includes('itemprop="url"'), "should contain url itemprop");
      if (photoPath) {
        assert.ok(html.includes('itemprop="image"'), "should contain image itemprop");
      } else {
        assert.ok(!html.includes('itemprop="image"'), "should omit image itemprop without a photo");
      }
    });
  });

  describe("Contact URLs are linkified", () => {
    it("renders email, website, and LinkedIn as clickable <a href> links", () => {
      const { html } = buildHtml(DEFAULT_ROLE, photoPath);
      assert.ok(
        html.includes('href="mailto:jane.doe@example.com"'),
        "email should be a mailto: link"
      );
      assert.ok(
        html.includes('href="https://jane-doe.example.com"'),
        "website should be an https link"
      );
      assert.ok(
        html.includes('href="https://www.linkedin.com/in/jane-doe"'),
        "LinkedIn should be an https link"
      );
    });

    it("wraps contact links in the cv-contact-value span", () => {
      const { html } = buildHtml(DEFAULT_ROLE, photoPath);
      assert.ok(
        html.includes('<span class="cv-contact-value"><a '),
        "links should be inside cv-contact-value spans"
      );
    });
  });

  describe("CSS — no negative-margin contact hack", () => {
    it("does not use negative margins for contact layout (breaks text extraction order)", () => {
      const css = readFileSync(CSS_PATH, "utf8");
      assert.ok(
        !css.includes("-54mm"),
        "CSS must not contain the old -54mm negative-margin hack that scrambles PDF text extraction order"
      );
      assert.ok(
        !/\.cv-header\s*(?:\+\s*ul|~\s*ul)/.test(css),
        "CSS must not select ul elements relative to .cv-header — contact info is now in <address>"
      );
    });

    it("uses compact header and body sizing globally with no variant-scoped rules", () => {
      const css = readFileSync(CSS_PATH, "utf8");
      assert.ok(
        !css.includes('[data-variant="'),
        "CSS should not contain variant-scoped rules — compact sizing is the global default"
      );
      assert.ok(
        css.includes("font-size: 22pt"),
        "name font-size should be the compact 22pt"
      );
      assert.ok(
        css.includes("font-size: 9.4pt"),
        "body font-size should be the compact 9.4pt"
      );
    });
  });

  describe("Role-aware PDF metadata", () => {
    it("roleMetadata uses the latest actual job title in subject and keywords for every role", () => {
      const expectedTitle = "Senior Software Engineer";
      for (const key of ROLE_KEYS) {
        const meta = roleMetadata(key);
        assert.strictEqual(meta.author, "Jane Doe", `${key}: author is constant`);
        assert.strictEqual(
          meta.subject,
          `${expectedTitle} — Curriculum Vitae`,
          `${key}: subject should reflect the latest actual job title`
        );
        assert.ok(
          meta.keywords.includes(expectedTitle),
          `${key}: keywords should include the latest actual job title`
        );
      }
    });

    it("roleMetadata keeps ATS-relevant skill keywords for every role", () => {
      for (const key of ROLE_KEYS) {
        const meta = roleMetadata(key);
        for (const skill of ["Java", "Python", "TypeScript", "Spring Boot", "Kubernetes", "Docker", "PostgreSQL", "React"]) {
          assert.ok(
            meta.keywords.includes(skill),
            `${key}: keywords should include "${skill}" for ATS matching`
          );
        }
      }
    });

    it("default CV_METADATA is the full variant metadata (backwards compatible)", () => {
      assert.strictEqual(
        CV_METADATA.subject,
        "Senior Software Engineer — Curriculum Vitae",
        "default metadata should target the full variant"
      );
    });

    it("embedPdfMetadata writes title, author, subject, and keywords into a PDF", async () => {
      const blankPdf = await PDFDocument.create();
      blankPdf.addPage([200, 200]);
      const blankBytes = await blankPdf.save();

      const testPdfPath = join(OUTPUT_DIR, "test-metadata.pdf");
      writeFileSync(testPdfPath, blankBytes);

      const meta = roleMetadata("staff");
      await embedPdfMetadata(testPdfPath, meta);

      const loaded = await PDFDocument.load(readFileSync(testPdfPath));
      assert.strictEqual(loaded.getTitle(), meta.title, "title should be embedded");
      assert.strictEqual(loaded.getAuthor(), meta.author, "author should be embedded");
      assert.strictEqual(loaded.getSubject(), meta.subject, "subject should be embedded");
      assert.ok(
        loaded.getKeywords().includes("Senior Software Engineer"),
        "keywords should embed the latest actual job title"
      );
      assert.ok(
        loaded.getKeywords().includes("Kubernetes"),
        "keywords should embed shared skill keywords"
      );
      assert.ok(loaded.getCreator(), "creator should be embedded");
    });
  });

  describe("Text extraction reading order", () => {
    it("renders text in logical ATS reading order: name → contact → summary → core skills → achievements → experience", async () => {
      const { html } = buildHtml("staff", photoPath);
      const css = readFileSync(CSS_PATH, "utf8");

      const browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: true,
      });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle0" });
        await page.addStyleTag({ content: css });

        const text = await page.evaluate(() => document.body.textContent);

        const nameIdx = text.indexOf("Jane Doe");
        const emailIdx = text.indexOf("jane.doe@example.com");
        const summaryIdx = text.indexOf("Summary");
        const coreSkillsIdx = text.indexOf("Core Skills");
        const keyAchievementsIdx = text.indexOf("Key Achievements");
        const experienceIdx = text.indexOf("Work Experience");

        assert.ok(nameIdx > -1, "name should be present in text");
        assert.ok(emailIdx > -1, "email should be present in text");
        assert.ok(summaryIdx > -1, "summary section should be present in text");
        assert.ok(coreSkillsIdx > -1, "core skills section should be present in text");
        assert.ok(keyAchievementsIdx > -1, "key achievements section should be present in text");
        assert.ok(experienceIdx > -1, "experience section should be present in text");

        assert.ok(nameIdx < emailIdx, "name should appear before contact info");
        assert.ok(emailIdx < summaryIdx, "contact info should appear before summary");
        assert.ok(summaryIdx < coreSkillsIdx, "summary should appear before core skills");
        assert.ok(coreSkillsIdx < keyAchievementsIdx, "core skills should appear before key achievements");
        assert.ok(keyAchievementsIdx < experienceIdx, "key achievements should appear before work experience");
      } finally {
        await browser.close();
      }
    });
  });

  describe("Lead (compact) variant", () => {
    it("defines the lead role with compact: { firstNFull: 2 }", () => {
      assert.ok(ROLES.lead, "ROLES should include a lead variant");
      assert.ok(ROLES.lead.compact, "lead role should set compact truthy");
      assert.deepStrictEqual(
        ROLES.lead.compact,
        { firstNFull: 2 },
        "lead role should have compact: { firstNFull: 2 }"
      );
    });

    it("composeMarkdown for lead strips Stack lines, keeps all bullets for first 2 entries, trims rest", () => {
      const composed = composeMarkdown("lead");
      assert.ok(
        !composed.body.includes("**Stack:**"),
        "lead: composed body should not contain any Stack lines"
      );
      assert.ok(
        composed.body.includes("Work Experience"),
        "lead: composed body should contain Work Experience"
      );
      const seniorIdx = composed.body.indexOf("### Senior Software Engineer");
      assert.ok(seniorIdx > -1, "lead: should contain Senior Software Engineer entry");
      const afterSenior = composed.body.slice(seniorIdx);
      const endOfSenior = afterSenior.indexOf("### Software Engineer");
      const seniorSection = afterSenior.slice(0, endOfSenior);
      const seniorBullets = (seniorSection.match(/^- /gm) || []).length;
      assert.strictEqual(seniorBullets, 2, "lead: Senior Software Engineer should keep 2 bullets");
      const engineerIdx = composed.body.indexOf("### Software Engineer");
      assert.ok(engineerIdx > -1, "lead: should contain Software Engineer entry");
      const afterEngineer = composed.body.slice(engineerIdx);
      const endOfEngineer = afterEngineer.indexOf("### Junior Software Engineer");
      const engineerSection = afterEngineer.slice(0, endOfEngineer);
      const engineerBullets = (engineerSection.match(/^- /gm) || []).length;
      assert.strictEqual(engineerBullets, 2, "lead: Software Engineer should keep 2 bullets");
      const juniorIdx = composed.body.indexOf("### Junior Software Engineer");
      const afterJunior = composed.body.slice(juniorIdx);
      const endOfJunior = afterJunior.indexOf("### Intern");
      const juniorSection = afterJunior.slice(0, endOfJunior > 0 ? endOfJunior : undefined);
      const juniorBullets = (juniorSection.match(/^- /gm) || []).length;
      assert.strictEqual(juniorBullets, 1, "lead: third entry should be trimmed to 1 bullet");
    });

    it("composeMarkdown for lead includes Honors and Awards", () => {
      const composed = composeMarkdown("lead");
      assert.ok(
        composed.body.includes("## Honors and Awards"),
        "lead: should contain Honors and Awards"
      );
      assert.ok(
        composed.body.includes("Employee of the Quarter"),
        "lead: Honors content should be present"
      );
    });
  });

  describe("compactWorkExperience", () => {
    const sampleMd = `## Work Experience

### Senior SWE — Acme
*2025 – Current*

- Bullet A
- Bullet B
- Bullet C

**Stack:** Java | Docker

### SWE — Acme
*2024 – 2025*

- Bullet X
- Bullet Y

**Stack:** Java | Go

### Old Role — OldCo
*2014 – 2015*

- Bullet Z
- Bullet W

**Stack:** C++
`;

    it("strips Stack lines from all entries", () => {
      const result = compactWorkExperience(sampleMd);
      assert.ok(
        !result.includes("**Stack:**"),
        "compactWorkExperience should strip all Stack lines"
      );
    });

    it("trims bullets: keeps 1 for all entries in compact mode", () => {
      const result = compactWorkExperience(sampleMd);
      const oldRoleStart = result.indexOf("### Old Role");
      const oldRoleSection = result.slice(oldRoleStart);
      const bulletMatches = oldRoleSection.match(/^- /gm);
      assert.ok(bulletMatches, "Old Role should have at least 1 bullet");
      assert.strictEqual(bulletMatches.length, 1, "Old Role should have exactly 1 bullet");
    });

    it("preserves non-Work-Experience sections unchanged", () => {
      const input = `## Education\n\nSome content\n\n## Work Experience\n\n### Role A — Co\n*2020 – 2021*\n\n- Bullet 1\n- Bullet 2\n\n**Stack:** X\n`;
      const result = compactWorkExperience(input);
      assert.ok(
        result.includes("## Education"),
        "should preserve Education section"
      );
      assert.ok(
        result.includes("Some content"),
        "should preserve Education content"
      );
    });

    it("returns the input unchanged if there is no Work Experience section", () => {
      const input = "## Education\n\nSome content";
      const result = compactWorkExperience(input);
      assert.strictEqual(result, input);
    });

    it("collapses last 3 entries into a single Early Career entry with separate bullet points for each company", () => {
      const multiEntryMd = `## Work Experience

### Role A — Co A
*2025 – Current*

- Bullet A1

### Role B — Co B
*2024 – 2025*

- Bullet B1

### Role C — Co C
*2016 – 2017*

- Bullet C1

### Role D — Co D
*2015 – 2016*

- Bullet D1

### Role E — Co E
*2014 – 2015*

- Bullet E1
`;
      const result = compactWorkExperience(multiEntryMd);
      assert.ok(
        result.includes("### Early Career"),
        "should create Early Career entry from last 3 roles"
      );
      assert.ok(
        !result.includes("### Role C"),
        "should remove individual Role C entry"
      );
      assert.ok(
        !result.includes("### Role D"),
        "should remove individual Role D entry"
      );
      assert.ok(
        !result.includes("### Role E"),
        "should remove individual Role E entry"
      );
      assert.ok(
        result.includes("**Co C — Role C (2016 – 2017)**: Bullet C1"),
        "Early Career should derive a bullet for the first collapsed role"
      );
      assert.ok(
        result.includes("**Co E — Role E (2014 – 2015)**: Bullet E1"),
        "Early Career should derive a bullet for the last collapsed role"
      );
      assert.ok(
        result.includes("*2014 – 2017*"),
        "Early Career should derive its date range from the collapsed roles"
      );
    });

    it("keeps all bullets for first N entries when firstNFull is set, always strips Stack lines", () => {
      const multiEntryMd = `## Work Experience

### Role A — Co A
*2025 – Current*

- Bullet A1
- Bullet A2
- Bullet A3

**Stack:** Java | Docker

### Role B — Co B
*2024 – 2025*

- Bullet B1
- Bullet B2

**Stack:** Go | K8s

### Role C — Co C
*2023 – 2024*

- Bullet C1
- Bullet C2
- Bullet C3

**Stack:** Python

### Role D — Co D
*2022 – 2023*

- Bullet D1
- Bullet D2

**Stack:** Node

### Role E — Co E
*2021 – 2022*

- Bullet E1
- Bullet E2

**Stack:** Ruby

### Role F — Co F
*2020 – 2021*

- Bullet F1

**Stack:** PHP

### Role G — Co G
*2019 – 2020*

- Bullet G1
- Bullet G2

**Stack:** C++

### Role H — Co H
*2018 – 2019*

- Bullet H1

**Stack:** Rust

### Role I — Co I
*2017 – 2018*

- Bullet I1
- Bullet I2

**Stack:** Scala
`;
      const result = compactWorkExperience(multiEntryMd, { firstNFull: 2 });
      // Stack lines are always stripped in compact mode
      assert.ok(!result.includes("**Stack:**"),
        "no Stack lines should survive, even for first N entries");
      // First 2 entries should keep all bullets
      assert.ok(result.includes("Bullet A1") && result.includes("Bullet A2") && result.includes("Bullet A3"),
        "first entry should keep all 3 bullets");
      assert.ok(result.includes("Bullet B1") && result.includes("Bullet B2"),
        "second entry should keep all 2 bullets");
      // Entries 3+ should be trimmed to 1 bullet
      assert.ok(result.includes("Bullet C1") && !result.includes("Bullet C2"),
        "third entry should be trimmed to 1 bullet");
      assert.ok(result.includes("Bullet D1") && !result.includes("Bullet D2"),
        "fourth entry should be trimmed to 1 bullet");
      // Entries G, H, I (last 3) should be collapsed into Early Career
      assert.ok(result.includes("### Early Career"),
        "last 3 entries should be collapsed into Early Career");
      assert.ok(!result.includes("### Role G"),
        "collapsed entry G should not appear individually");
      assert.ok(!result.includes("### Role H"),
        "collapsed entry H should not appear individually");
      assert.ok(!result.includes("### Role I"),
        "collapsed entry I should not appear individually");
    });

    it("treats firstNFull = 0 the same as not passing the option", () => {
      const multiEntryMd = `## Work Experience

### Role A — Co A
*2025 – Current*

- Bullet A1
- Bullet A2

**Stack:** Java

### Role B — Co B
*2024 – 2025*

- Bullet B1
- Bullet B2

**Stack:** Go

### Role C — Co C
*2016 – 2017*

- Bullet C1

### Role D — Co D
*2015 – 2016*

- Bullet D1

### Role E — Co E
*2014 – 2015*

- Bullet E1
`;
      const withZero = compactWorkExperience(multiEntryMd, { firstNFull: 0 });
      const withoutOpt = compactWorkExperience(multiEntryMd);
      assert.strictEqual(withZero, withoutOpt,
        "firstNFull:0 should produce the same result as no option");
      assert.ok(!withZero.includes("**Stack:**"),
        "no Stack lines should survive with firstNFull:0");
    });

    it("does not collapse when there are fewer than 5 entries", () => {
      const twoEntryMd = `## Work Experience

### Role A — Co A
*2025 – Current*

- Bullet A1

- Bullet A2

### Role B — Co B
*2024 – 2025*

- Bullet B1

- Bullet B2

### Role C — Co C
*2016 – 2017*

- Bullet C1

### Role D — Co D
*2014 – 2015*

- Bullet D1
`;
      const result = compactWorkExperience(twoEntryMd);
      assert.ok(
        !result.includes("### Early Career"),
        "should not create Early Career with only 4 entries"
      );
    });
  });

  describe("trimBullets", () => {
    it("keeps at most N bullet lines per entry", () => {
      const entry = "### Title\n*date*\n\n- Bullet 1\n- Bullet 2\n- Bullet 3\n\nSome text\n";
      const result = trimBullets(entry, 2);
      const bullets = result.match(/^- /gm);
      assert.strictEqual(bullets.length, 2, "should keep exactly 2 bullets");
      assert.ok(result.includes("Bullet 1"), "should keep first bullet");
      assert.ok(result.includes("Bullet 2"), "should keep second bullet");
      assert.ok(!result.includes("Bullet 3"), "should drop third bullet");
    });

    it("preserves non-bullet lines (heading, date, text)", () => {
      const entry = "### Title\n*date*\n\n- Bullet 1\n\nSome text\n";
      const result = trimBullets(entry, 1);
      assert.ok(result.includes("### Title"), "should preserve heading");
      assert.ok(result.includes("*date*"), "should preserve date line");
      assert.ok(result.includes("Some text"), "should preserve text");
    });

    it("returns the entry unchanged if bullet count is within limit", () => {
      const entry = "### Title\n*date*\n\n- Bullet 1\n";
      const result = trimBullets(entry, 3);
      assert.strictEqual(
        result.trim(),
        entry.trim(),
        "should not modify when under limit"
      );
    });
  });

  describe("Visual regression", () => {
    it("renders the full variant without visual regressions", async () => {
      const { html } = buildHtml(DEFAULT_ROLE, photoPath);
      const screenshot = await captureFullPage(html, CSS_PATH);

      writeFileSync(ACTUAL_SCREENSHOT, screenshot);

      if (!existsSync(BASELINE_SCREENSHOT)) {
        writeFileSync(BASELINE_SCREENSHOT, screenshot);
        console.log(`  Baseline screenshot created at ${BASELINE_SCREENSHOT}`);
        return;
      }

      const baselinePng = PNG.sync.read(readFileSync(BASELINE_SCREENSHOT));
      const actualPng = PNG.sync.read(screenshot);

      if (baselinePng.width !== actualPng.width || baselinePng.height !== actualPng.height) {
        assert.fail(
          `Screenshot dimensions differ: baseline ${baselinePng.width}x${baselinePng.height} vs actual ${actualPng.width}x${actualPng.height}`
        );
      }

      const diff = new PNG({ width: baselinePng.width, height: baselinePng.height });
      const numDiffPixels = pixelmatch(
        baselinePng.data,
        actualPng.data,
        diff.data,
        baselinePng.width,
        baselinePng.height,
        { threshold: 0.05 }
      );

      if (numDiffPixels > 0) {
        writeFileSync(DIFF_SCREENSHOT, PNG.sync.write(diff));
      }

      const totalPixels = baselinePng.width * baselinePng.height;
      const diffPercent = ((numDiffPixels / totalPixels) * 100).toFixed(3);

      assert.ok(
        numDiffPixels === 0,
        `Visual regression detected: ${numDiffPixels} differing pixels (${diffPercent}%). Diff saved to ${DIFF_SCREENSHOT}`
      );
    });
  });
});
