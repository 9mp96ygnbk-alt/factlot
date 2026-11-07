#!/usr/bin/env node
// Sets one version across every FactLot package.
//
//   node scripts/release/bump.mjs <patch|minor|major|x.y.z[-pre.N]> [--dry-run]
//
// Every package in this repository (npm workspaces and the Python package) shares one
// version. This script rewrites, in place:
//   packages/*/package.json          "version", and every "@factlot/*" dependency range
//   package-lock.json                the workspace entries for the same packages
//   python/pyproject.toml            [project] version
//   python/src/factlot/__init__.py   __version__ (reported as the Python tools "producer")
//   packages/tools/src/catalog.ts    CATALOG_VERSION (tool producer, OpenAPI info.version)
//   packages/mcp/src/index.ts        SERVER_VERSION (MCP server version, .mcpb manifest)
//   python/src/factlot/collector/core.py
//                                    VERSION, the collector's User-Agent (major.minor only)
//   connectors/microsoft/copilot-studio-connector.swagger.yaml
//                                    info.version (hand-maintained Swagger 2.0 file)
//
// It does NOT touch calculator or rule `version` fields (those are formula versions, see
// AGENTS.md rule 3), and it does not regenerate spec/schemas: run `npm run schemas` after
// bumping so the generated OpenAPI documents pick up CATALOG_VERSION.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKSPACES = [
  "schema",
  "id",
  "calc",
  "tools",
  "mcp",
  "server",
  "reports",
];
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

function usage(message) {
  if (message) console.error(`error: ${message}\n`);
  console.error(
    "usage: node scripts/release/bump.mjs <patch|minor|major|x.y.z[-pre.N]> [--dry-run]",
  );
  process.exit(message ? 1 : 0);
}

function read(file) {
  return readFileSync(join(root, file), "utf8");
}

function currentVersion() {
  const versions = new Map();
  for (const ws of WORKSPACES) {
    const file = `packages/${ws}/package.json`;
    versions.set(file, JSON.parse(read(file)).version);
  }
  versions.set(
    "python/pyproject.toml",
    /^version = "([^"]+)"$/m.exec(read("python/pyproject.toml"))?.[1],
  );
  const distinct = new Set(versions.values());
  if (distinct.size !== 1) {
    const list = [...versions].map(([f, v]) => `  ${f}: ${v}`).join("\n");
    throw new Error(`packages disagree on the current version:\n${list}`);
  }
  return [...distinct][0];
}

function nextVersion(current, request) {
  if (SEMVER.test(request)) return request;
  const m = SEMVER.exec(current);
  if (!m) throw new Error(`current version ${current} is not semver`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  switch (request) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      return usage(`"${request}" is not patch, minor, major, or x.y.z`);
  }
}

/** Replaces exactly one match of `pattern` in `text`; throws when it matches 0 or 2+ times. */
function replaceOnce(file, text, pattern, replacement) {
  const matches = text.match(new RegExp(pattern.source, pattern.flags + "g"));
  if (!matches || matches.length !== 1) {
    throw new Error(
      `${file}: expected exactly one match of ${pattern}, found ${matches?.length ?? 0}`,
    );
  }
  return text.replace(pattern, replacement);
}

function setInternalDeps(deps, version) {
  if (!deps) return;
  for (const name of Object.keys(deps)) {
    if (name.startsWith("@factlot/")) deps[name] = version;
  }
}

function plan(version) {
  const edits = [];
  const json = (data) => `${JSON.stringify(data, null, 2)}\n`;

  for (const ws of WORKSPACES) {
    const file = `packages/${ws}/package.json`;
    const pkg = JSON.parse(read(file));
    pkg.version = version;
    for (const key of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      setInternalDeps(pkg[key], version);
    }
    edits.push({ file, text: json(pkg) });
  }

  const lock = JSON.parse(read("package-lock.json"));
  for (const ws of WORKSPACES) {
    const entry = lock.packages[`packages/${ws}`];
    if (!entry)
      throw new Error(`package-lock.json has no entry for packages/${ws}`);
    entry.version = version;
    for (const key of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      setInternalDeps(entry[key], version);
    }
  }
  edits.push({ file: "package-lock.json", text: json(lock) });

  const major_minor = version.split(".").slice(0, 2).join(".");
  const textual = [
    ["python/pyproject.toml", /^version = "[^"]+"$/m, `version = "${version}"`],
    [
      "python/src/factlot/__init__.py",
      /^__version__ = "[^"]+"$/m,
      `__version__ = "${version}"`,
    ],
    [
      "packages/tools/src/catalog.ts",
      /^export const CATALOG_VERSION = "[^"]+";$/m,
      `export const CATALOG_VERSION = "${version}";`,
    ],
    [
      "packages/mcp/src/index.ts",
      /^export const SERVER_VERSION = "[^"]+";$/m,
      `export const SERVER_VERSION = "${version}";`,
    ],
    [
      "python/src/factlot/collector/core.py",
      /^VERSION = "[^"]+"$/m,
      `VERSION = "${major_minor}"`,
    ],
    [
      "connectors/microsoft/copilot-studio-connector.swagger.yaml",
      /^( {2}version: )\S+$/m,
      `$1${version}`,
    ],
  ];
  for (const [file, pattern, replacement] of textual) {
    edits.push({
      file,
      text: replaceOnce(file, read(file), pattern, replacement),
    });
  }
  return edits;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const request = args.find((a) => !a.startsWith("--"));
  if (!request || args.includes("--help") || args.includes("-h")) usage();

  const current = currentVersion();
  const version = nextVersion(current, request);
  const edits = plan(version);

  let changed = 0;
  for (const { file, text } of edits) {
    if (read(file) === text) continue;
    changed += 1;
    console.log(`${dryRun ? "would update" : "updated"} ${file}`);
    if (!dryRun) writeFileSync(join(root, file), text);
  }

  console.log(
    `\n${current} -> ${version}: ${changed} file(s) ${dryRun ? "to change" : "changed"}, ${edits.length - changed} already current.`,
  );
  if (changed && !dryRun) {
    console.log(`
Next:
  npm run schemas                                    # regenerate the OpenAPI documents (info.version)
  node scripts/release/changelog.mjs release ${version}   # move Unreleased under ${version}
  git diff                                           # review, then commit "Release ${version}"
See docs/release-process.md for the full procedure.`);
  }
}

try {
  main();
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
