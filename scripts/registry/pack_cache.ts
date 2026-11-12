/**
 * The parts cache of a parallel pack build (pack.ts --parts-cache <dir>): finished regions kept with a stamp, so a
 * later build takes an unchanged region from the cache instead of packing it again. A part is reused only when its
 * stamp matches exactly and every cached byte still hashes to what was stored; anything else is rebuilt.
 *
 * The stamp of a region covers what its part's bytes depend on: the registry file's content (size and sha256, and
 * any -wal or -journal beside it), the region name and its index k, every option that reaches the part (the
 * counties excluded, the suppression list's contents, the entity cut-off, the privacy scan setting, the file
 * limit), the code version (a hash over the source files the part is made by, found by following imports from
 * pack.ts, plus the versions of the npm packages they import and, with the privacy scan, the Python scan modules)
 * and the Node and SQLite versions.
 *
 * Layout of <dir>:
 *   regions/<name>/stamp.json     the stamp and the sha256 of contents.json; written before the entry is renamed
 *                                 into place, so an entry without it is partial and is never used
 *   regions/<name>/contents.json  every cached file with its size and sha256, and part.jsonl's
 *   regions/<name>/part.jsonl     the part as the region's process wrote it
 *   regions/<name>/files/         the part's pack files: g/<k>/… and, for Texas, q/<pool>/…
 *   file-hashes.json              sha256 of registry files by path, size, mtime and inode (a 13 GB file is read once)
 *   .lock                         held while a build uses the cache
 * The cache is written only after a build has succeeded; a build that fails leaves it as it was.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import type { BigIntStats } from "node:fs";
import { dirname, join, posix } from "node:path";

import ts from "typescript";

/** Bump when the stamp's shape or meaning changes. */
export const STAMP_SCHEMA = 1;

export const sha256 = (text: string | Buffer): string =>
  createHash("sha256").update(text).digest("hex");

// --- code version ------------------------------------------------------------------------------

/** Reads a repository file by its path from the repository root; undefined when it does not exist. */
export type Reader = (rel: string) => string | undefined;

export const fsReader =
  (root: string): Reader =>
  (rel) => {
    const p = join(root, rel);
    return existsSync(p) ? readFileSync(p, "utf8") : undefined;
  };

/** The repository's files as they were at a commit. */
export const gitReader =
  (root: string, commit: string): Reader =>
  (rel) => {
    try {
      return execFileSync("git", ["-C", root, "show", `${commit}:${rel}`], {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return undefined;
    }
  };

/** Where the import walk starts: the program that builds a part. */
export const CODE_ROOT = "scripts/registry/pack.ts";
/** The Python module pack.ts runs as the privacy scan. */
export const PRIVACY_ROOT = "python/src/factlot/registry/privacy_scan.py";

export interface CodeVersion {
  version: string;
  /** Repository path → sha256 of every source file reached. */
  files: Record<string, string>;
  /** npm package → version (from package-lock.json) of every package those files import. */
  packages: Record<string, string>;
}

/** The module specifiers a TypeScript file imports (TypeScript's own scanner: comments and strings are skipped). */
function tsImports(text: string): string[] {
  return ts
    .preProcessFile(text, true, true)
    .importedFiles.map((f) => f.fileName);
}

/**
 * The code version of the part builder: every TypeScript file reached from pack.ts by its imports (relative ones,
 * and @factlot/* through each package's factlot-source entry), the versions of the other packages they import,
 * and, with `privacyScan`, the Python scan module and the factlot modules it imports. Any edit to any of them
 * gives a new version; nothing is listed by hand, so a new module is covered as soon as it is imported.
 */
export function codeVersion(read: Reader, privacyScan: boolean): CodeVersion {
  const files: Record<string, string> = {};
  const packages: Record<string, string> = {};
  const lock = JSON.parse(read("package-lock.json") ?? "{}") as {
    packages?: Record<string, { version?: string }>;
  };
  const need = (rel: string): string => {
    const text = read(rel);
    if (text === undefined) throw new Error(`code version: ${rel} not found`);
    return text;
  };
  const queue = [CODE_ROOT];
  while (queue.length) {
    const rel = queue.pop()!;
    if (Object.hasOwn(files, rel)) continue;
    const text = need(rel);
    files[rel] = sha256(text);
    for (const spec of tsImports(text)) {
      if (spec.startsWith("node:")) continue;
      if (spec.startsWith(".")) {
        queue.push(posix.normalize(posix.join(posix.dirname(rel), spec)));
        continue;
      }
      const parts = spec.split("/");
      const pkg = spec.startsWith("@")
        ? parts.slice(0, 2).join("/")
        : parts[0]!;
      if (pkg.startsWith("@factlot/")) {
        if (pkg !== spec)
          throw new Error(`code version: ${rel} imports ${spec}, a subpath`);
        const dir = `packages/${pkg.slice("@factlot/".length)}`;
        const manifest = JSON.parse(need(`${dir}/package.json`)) as {
          exports?: { ".": Record<string, string> };
        };
        const entry = manifest.exports?.["."]?.["factlot-source"];
        if (!entry)
          throw new Error(`code version: ${pkg} has no factlot-source`);
        files[`${dir}/package.json`] = sha256(need(`${dir}/package.json`));
        queue.push(posix.normalize(posix.join(dir, entry)));
        continue;
      }
      const version = lock.packages?.[`node_modules/${pkg}`]?.version;
      if (!version)
        throw new Error(
          `code version: ${rel} imports ${pkg}, not in package-lock.json`,
        );
      packages[pkg] = version;
    }
  }
  if (privacyScan) pythonClosure(read, need, files);
  const sorted = <T>(o: Record<string, T>) =>
    Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, o[k]!]),
    );
  const out = { files: sorted(files), packages: sorted(packages) };
  return { version: sha256(JSON.stringify(out)), ...out };
}

const PY_SRC = "python/src";

/** The Python module and the factlot modules (and package __init__ files) it imports, transitively. */
function pythonClosure(
  read: Reader,
  need: (rel: string) => string,
  files: Record<string, string>,
): void {
  const moduleFile = (dotted: string): string | undefined => {
    const base = `${PY_SRC}/${dotted.replaceAll(".", "/")}`;
    for (const f of [`${base}.py`, `${base}/__init__.py`])
      if (read(f) !== undefined) return f;
    return undefined;
  };
  // A module's package is its directory; an __init__.py's is the package it starts.
  const packageOf = (rel: string): string[] =>
    rel
      .slice(PY_SRC.length + 1)
      .split("/")
      .slice(0, -1);
  const queue = [PRIVACY_ROOT];
  while (queue.length) {
    const rel = queue.pop()!;
    if (Object.hasOwn(files, rel)) continue;
    const text = need(rel);
    files[rel] = sha256(text);
    const pkg = packageOf(rel);
    // The __init__ of every package on the way runs on import.
    for (let i = 1; i <= pkg.length; i++) {
      const init = moduleFile(pkg.slice(0, i).join("."));
      if (init) queue.push(init);
    }
    const add = (dotted: string, names: string[]) => {
      const f = moduleFile(dotted);
      if (f) queue.push(f);
      // "from . import x": x may be a module.
      for (const n of names) {
        const sub = moduleFile(`${dotted}.${n}`);
        if (sub) queue.push(sub);
      }
    };
    for (const m of text.matchAll(
      /^\s*from\s+(\.*)([\w.]*)\s+import\s+\(?([\w\s,]*)/gm,
    )) {
      const dots = m[1]!.length;
      const names = m[3]!
        .split(",")
        .map((s) => s.trim().split(/\s+/)[0]!)
        .filter(Boolean);
      if (dots) {
        const up = pkg.slice(0, pkg.length - (dots - 1));
        add([...up, ...(m[2] ? [m[2]] : [])].join("."), names);
      } else if (m[2] === "factlot" || m[2]!.startsWith("factlot."))
        add(m[2]!, names);
    }
    for (const m of text.matchAll(/^\s*import\s+(factlot[\w.]*)/gm))
      add(m[1]!, []);
  }
}

// --- registry file hashes -----------------------------------------------------------------------

export interface FileId {
  bytes: number;
  sha256: string;
}

/** A registry file's content: the database and any write-ahead log or rollback journal beside it. */
export interface SourceId extends FileId {
  wal: FileId | null;
  journal: FileId | null;
}

interface HashRecord extends FileId {
  mtime_ns: string;
  ino: string;
  dev: string;
}

/** sha256 of a file, streamed. */
export function hashFile(path: string): FileId {
  const h = createHash("sha256");
  const fd = openSync(path, "r");
  const buf = Buffer.allocUnsafe(8 << 20);
  let bytes = 0;
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      h.update(n === buf.length ? buf : buf.subarray(0, n));
      bytes += n;
    }
  } finally {
    closeSync(fd);
  }
  return { bytes, sha256: h.digest("hex") };
}

/** File hashes remembered by path, size, mtime and inode, so a large unchanged file is hashed once. */
export class FileHashes {
  private readonly records: Record<string, HashRecord>;
  private dirty = false;
  readonly file: string;
  constructor(file: string) {
    this.file = file;
    let records: Record<string, HashRecord> = {};
    try {
      records = JSON.parse(readFileSync(file, "utf8")) as typeof records;
    } catch {
      // absent or unreadable: hash again
    }
    this.records = records;
  }

  get(path: string): FileId {
    const real = realpathSync(path);
    const key = (s: BigIntStats) => ({
      bytes: Number(s.size),
      mtime_ns: String(s.mtimeNs),
      ino: String(s.ino),
      dev: String(s.dev),
    });
    const before = key(statSync(real, { bigint: true }));
    const r = this.records[real];
    if (
      r &&
      r.bytes === before.bytes &&
      r.mtime_ns === before.mtime_ns &&
      r.ino === before.ino &&
      r.dev === before.dev
    )
      return { bytes: r.bytes, sha256: r.sha256 };
    const id = hashFile(real);
    const after = key(statSync(real, { bigint: true }));
    if (
      JSON.stringify(after) !== JSON.stringify(before) ||
      id.bytes !== before.bytes
    )
      throw new Error(`${path} changed while it was being hashed`);
    this.records[real] = { ...after, sha256: id.sha256 };
    this.dirty = true;
    return id;
  }

  /** The content of a registry file: the database and its -wal and -journal when present and not empty. */
  source(path: string): SourceId {
    const side = (suffix: string): FileId | null => {
      const p = `${path}${suffix}`;
      return existsSync(p) && statSync(p).size > 0 ? this.get(p) : null;
    };
    return { ...this.get(path), wal: side("-wal"), journal: side("-journal") };
  }

  save(): void {
    if (!this.dirty) return;
    const tmp = `${this.file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(this.records, null, 1));
    renameSync(tmp, this.file);
    this.dirty = false;
  }
}

// --- the stamp ----------------------------------------------------------------------------------

export interface PartStamp {
  schema: number;
  region: string;
  k: number;
  source: SourceId;
  options: {
    exclude: string[];
    entity_whole_max: number;
    /** sha256 of the suppression list ({subjects, owner_names}), or null for none. */
    suppression: string | null;
    privacy_scan: boolean;
    max_files: number;
  };
  code: string;
  runtime: { node: string; sqlite: string };
}

/** The suppression list's identity: its contents hashed, never the names themselves. */
export function suppressionId(
  s: { subjects: string[]; owner_names: string[] } | undefined,
): string | null {
  if (!s || (!s.subjects.length && !s.owner_names.length)) return null;
  return sha256(
    JSON.stringify({ subjects: s.subjects, owner_names: s.owner_names }),
  );
}

export const runtimeId = (): PartStamp["runtime"] => ({
  node: process.version,
  sqlite: process.versions.sqlite ?? "",
});

// --- entries ------------------------------------------------------------------------------------

/** A cached file: its path in the pack, size and sha256. */
export type CachedFile = [string, number, string];

interface Contents {
  files: CachedFile[];
  part: FileId;
}

export interface CacheEntry {
  dir: string;
  partFile: string;
  /** The part's pack files, verified against contents.json. */
  files: CachedFile[];
}

/** Every file under `root`, as sorted posix paths relative to it. */
export function listFiles(root: string, prefix = ""): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), r);
      else out.push(r);
    }
  };
  const start = prefix ? join(root, prefix) : root;
  if (existsSync(start)) walk(start, prefix);
  return out.sort();
}

/** Copy (a copy-on-write clone where the file system has them): the source is never changed or shared. */
export function cloneFile(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to, constants.COPYFILE_FICLONE);
}

export class PartsCache {
  readonly dir: string;
  readonly hashes: FileHashes;
  private readonly lock: string;

  /** Opens (creating) the cache and takes its lock; release() when done. */
  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(join(dir, "regions"), { recursive: true });
    this.lock = join(dir, ".lock");
    let fd: number;
    try {
      fd = openSync(this.lock, "wx");
    } catch {
      throw new Error(
        `${dir} is in use by another build (${this.lock}); remove the lock file if no build is running`,
      );
    }
    writeSync(fd, String(process.pid));
    closeSync(fd);
    this.hashes = new FileHashes(join(dir, "file-hashes.json"));
  }

  release(): void {
    rmSync(this.lock, { force: true });
  }

  entryDir(region: string): string {
    return join(this.dir, "regions", region);
  }

  /**
   * The cached part of `region` when its stamp is `stamp` and every cached byte is intact; otherwise why not. Reads
   * and hashes every cached file (a few GB for Texas, seconds), so a damaged or partial entry is never used.
   */
  load(
    region: string,
    stamp: PartStamp,
  ): { entry: CacheEntry } | { reason: string } {
    const dir = this.entryDir(region);
    const stampFile = join(dir, "stamp.json");
    if (!existsSync(dir)) return { reason: "not in the cache" };
    if (!existsSync(stampFile))
      return { reason: "the cache entry is partial (no stamp)" };
    let saved: { stamp: PartStamp; contents: string };
    try {
      saved = JSON.parse(readFileSync(stampFile, "utf8")) as typeof saved;
    } catch {
      return { reason: "the cache entry's stamp is unreadable" };
    }
    if (JSON.stringify(saved.stamp) !== JSON.stringify(stamp))
      return { reason: `stamp differs (${stampDiff(saved.stamp, stamp)})` };
    const contentsFile = join(dir, "contents.json");
    if (
      !existsSync(contentsFile) ||
      hashFile(contentsFile).sha256 !== saved.contents
    )
      return { reason: "the cache entry's contents list is damaged" };
    const contents = JSON.parse(readFileSync(contentsFile, "utf8")) as Contents;
    const partFile = join(dir, "part.jsonl");
    if (
      !existsSync(partFile) ||
      JSON.stringify(hashFile(partFile)) !== JSON.stringify(contents.part)
    )
      return { reason: "the cached part.jsonl is damaged" };
    const root = join(dir, "files");
    const present = listFiles(root);
    if (
      JSON.stringify(present) !==
      JSON.stringify(contents.files.map((f) => f[0]))
    )
      return {
        reason: "the cached files are not those listed (missing or extra)",
      };
    for (const [path, bytes, sum] of contents.files) {
      const id = hashFile(join(root, path));
      if (id.bytes !== bytes || id.sha256 !== sum)
        return { reason: `the cached file ${path} is damaged` };
    }
    return { entry: { dir, partFile, files: contents.files } };
  }

  /**
   * Store a finished region: `paths` (pack paths under `root`) and its part.jsonl, then the stamp, then the entry is
   * renamed into place over any earlier one. Copies; `root` and `partFile` are only read.
   */
  store(
    region: string,
    stamp: PartStamp,
    partFile: string,
    root: string,
    paths: string[],
  ): void {
    const final = this.entryDir(region);
    const tmp = `${final}.tmp-${process.pid}`;
    rmSync(tmp, { recursive: true, force: true });
    try {
      const files: CachedFile[] = [];
      for (const p of [...paths].sort()) {
        const to = join(tmp, "files", p);
        cloneFile(join(root, p), to);
        const id = hashFile(to);
        files.push([p, id.bytes, id.sha256]);
      }
      cloneFile(partFile, join(tmp, "part.jsonl"));
      const contents: Contents = {
        files,
        part: hashFile(join(tmp, "part.jsonl")),
      };
      const contentsText = JSON.stringify(contents);
      writeFileSync(join(tmp, "contents.json"), contentsText);
      writeFileSync(
        join(tmp, "stamp.json"),
        JSON.stringify({ stamp, contents: sha256(contentsText) }, null, 1),
      );
      const old = `${final}.old-${process.pid}`;
      if (existsSync(final)) renameSync(final, old);
      renameSync(tmp, final);
      rmSync(old, { recursive: true, force: true });
    } catch (err) {
      rmSync(tmp, { recursive: true, force: true });
      throw err;
    }
  }
}

/** Which top-level parts of two stamps differ, for the log. */
function stampDiff(a: PartStamp, b: PartStamp): string {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<
    keyof PartStamp
  >;
  const out: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    if (k === "options")
      for (const o of Object.keys({
        ...a.options,
        ...b.options,
      }) as (keyof PartStamp["options"])[])
        if (JSON.stringify(a.options?.[o]) !== JSON.stringify(b.options?.[o]))
          out.push(`options.${o}`);
    if (k !== "options") out.push(k === "source" ? "registry file" : k);
  }
  return out.join(", ") || "format";
}
