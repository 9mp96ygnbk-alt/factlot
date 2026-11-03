#!/usr/bin/env node
// Maintains CHANGELOG.md (Keep a Changelog 1.1.0 format).
//
//   node scripts/release/changelog.mjs check                 fail unless Unreleased has content
//   node scripts/release/changelog.mjs release <x.y.z> [date]  move Unreleased under a new version
//   node scripts/release/changelog.mjs notes <x.y.z>         print that version's section (release notes)
//
// `release` keeps an empty "## [Unreleased]" heading at the top and rewrites the comparison
// links at the bottom of the file. `notes` is what the release workflow attaches to the GitHub
// release.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHANGELOG = join(root, "CHANGELOG.md");
const REPO = "https://github.com/9mp96ygnbk-alt/factlot";
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const HEADING = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/;

function usage(message) {
  if (message) console.error(`error: ${message}\n`);
  console.error(`usage: node scripts/release/changelog.mjs check
       node scripts/release/changelog.mjs release <x.y.z> [YYYY-MM-DD]
       node scripts/release/changelog.mjs notes <x.y.z>`);
  process.exit(message ? 1 : 0);
}

/** Splits the changelog into its version sections, in file order. */
function parse(text) {
  const lines = text.split("\n");
  const sections = [];
  let current = null;
  const preamble = [];
  const links = [];
  for (const line of lines) {
    const m = HEADING.exec(line);
    if (m) {
      current = { version: m[1], date: m[2] ?? null, body: [] };
      sections.push(current);
    } else if (/^\[[^\]]+\]: \S+$/.test(line)) {
      links.push(line);
    } else if (current) {
      current.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  return { preamble, sections, links };
}

function trimBlankLines(lines) {
  const out = [...lines];
  while (out.length && out[0].trim() === "") out.shift();
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  return out;
}

function render({ preamble, sections, links }) {
  const parts = [trimBlankLines(preamble).join("\n")];
  for (const s of sections) {
    const heading = s.date
      ? `## [${s.version}] - ${s.date}`
      : `## [${s.version}]`;
    const body = trimBlankLines(s.body);
    parts.push(body.length ? `${heading}\n\n${body.join("\n")}` : heading);
  }
  parts.push(links.join("\n"));
  return `${parts.join("\n\n")}\n`;
}

function unreleased(doc) {
  const section = doc.sections.find((s) => s.version === "Unreleased");
  if (!section)
    throw new Error("CHANGELOG.md has no '## [Unreleased]' section");
  return section;
}

function check(doc) {
  const body = trimBlankLines(unreleased(doc).body);
  if (!body.length)
    throw new Error("the Unreleased section is empty; nothing to release");
  console.log(`Unreleased has ${body.length} line(s).`);
}

function release(doc, version, date) {
  if (!SEMVER.test(version)) usage(`"${version}" is not a semver version`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    usage(`"${date}" is not a YYYY-MM-DD date`);
  if (doc.sections.some((s) => s.version === version)) {
    throw new Error(`CHANGELOG.md already has a section for ${version}`);
  }
  const open = unreleased(doc);
  const body = trimBlankLines(open.body);
  if (!body.length)
    throw new Error("the Unreleased section is empty; nothing to release");

  const index = doc.sections.indexOf(open);
  const previous = doc.sections[index + 1]?.version ?? null;
  doc.sections.splice(index + 1, 0, { version, date, body });
  open.body = [];

  const rest = doc.links.filter(
    (l) => !l.startsWith("[Unreleased]: ") && !l.startsWith(`[${version}]: `),
  );
  doc.links = [
    `[Unreleased]: ${REPO}/compare/v${version}...HEAD`,
    previous
      ? `[${version}]: ${REPO}/compare/v${previous}...v${version}`
      : `[${version}]: ${REPO}/releases/tag/v${version}`,
    ...rest,
  ];
  writeFileSync(CHANGELOG, render(doc));
  console.log(
    `CHANGELOG.md: moved ${body.length} line(s) from Unreleased to ${version} (${date}).`,
  );
}

function notes(doc, version) {
  const section = doc.sections.find((s) => s.version === version);
  if (!section) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const body = trimBlankLines(section.body);
  if (!body.length) throw new Error(`the ${version} section is empty`);
  process.stdout.write(`${body.join("\n")}\n`);
}

function main() {
  const [command, version, dateArg] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") usage();
  const doc = parse(readFileSync(CHANGELOG, "utf8"));
  switch (command) {
    case "check":
      return check(doc);
    case "release":
      if (!version) usage("release needs a version");
      return release(
        doc,
        version,
        dateArg ?? new Date().toISOString().slice(0, 10),
      );
    case "notes":
      if (!version) usage("notes needs a version");
      return notes(doc, version);
    default:
      return usage(`unknown command "${command}"`);
  }
}

try {
  main();
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
