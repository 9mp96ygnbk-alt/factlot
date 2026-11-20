/**
 * The PDF of every report kind built on the neutral document model (doc.ts), laid out in the
 * institutional style (institutional.ts): masthead, title block, key figures, book-style
 * tables, numbered sections and back matter. Only presentation lives here; every figure,
 * warning, quotation and disclaimer is the kind's own text.
 *
 * Sections run in the order the kind builds them, numbered. The kind's closing blocks are
 * moved to the back: the audit trail, the basis of preparation (the old "Provenance", with the
 * statement of how the document was made) and, last, the inputs as sent in an appendix set in a
 * monospace face. Dates are written "July 8, 2026" everywhere except in that appendix, which
 * prints the arguments exactly as they were sent.
 */
import {
  RIGHT,
  fmtText,
  type Block,
  type Provenance,
  type ReportDoc,
} from "./doc.ts";
import {
  InstitutionalWriter,
  TEXT_W,
  type Cell,
  type DataTableOptions,
  type InstitutionalColumn,
} from "./institutional.ts";
import { longDate, longDates } from "./format.ts";

export { longDate, longDates };

/** Tables with more columns than this go on landscape pages. */
const WIDE_COLUMNS = 8;

const AUDIT_TRAIL = /^Audit trail/;
const INPUTS = /^Inputs\b/;
const PROVENANCE = /^Provenance$/;

interface Section {
  heading?: string;
  blocks: Block[];
}

/** Split the blocks at each heading; the blocks before the first heading come first. */
function sections(blocks: Block[]): Section[] {
  const out: Section[] = [{ blocks: [] }];
  for (const b of blocks) {
    if (b.t === "heading") out.push({ heading: b.text, blocks: [] });
    else out[out.length - 1]!.blocks.push(b);
  }
  return out.filter((s) => s.heading !== undefined || s.blocks.length > 0);
}

interface Prepared {
  columns: InstitutionalColumn[];
  rows: string[][];
  opts: DataTableOptions;
}

/** A table block as the writer takes it. `plainDates` keeps ISO dates (the inputs appendix). */
function prepTable(
  b: Extract<Block, { t: "table" }>,
  opts: { mono?: boolean; plainDates?: boolean } = {},
): Prepared {
  const text = (s: string) => (opts.plainDates ? s : longDates(s));
  const columns = b.columns.map<InstitutionalColumn>((c) => ({
    header: c.header,
    width: c.width ?? 1,
    align: RIGHT.has(c.fmt) ? "right" : "left",
    ...(opts.mono ? { mono: true } : {}),
  }));
  const rows = b.rows.map((r, k) =>
    r.map((v, i) => text(fmtText(v, b.fmts?.[k]?.[i] ?? b.columns[i]!.fmt))),
  );
  return {
    columns,
    rows,
    opts: {
      size: (b.size ?? 8) + 0.75,
      ...(b.bold?.length ? { bold: new Set(b.bold) } : {}),
    },
  };
}

function prepKv(b: Extract<Block, { t: "kv" }>): Prepared {
  return {
    columns: [
      { header: "", width: 0.58 },
      { header: "", width: 0.42, align: "right" },
    ],
    rows: b.rows.map((r) => [
      longDates(r.note ? `${r.label} (${r.note})` : r.label),
      longDates(fmtText(r.value, r.fmt)),
    ]),
    opts: { headerless: true, rules: true },
  };
}

/** The key figures' size: large, shrunk until they sit in a row without touching. */
function figureSize(w: InstitutionalWriter, cells: Cell[]): number {
  for (const size of [21, 19, 17, 15, 13]) {
    const need = cells.reduce(
      (s, c) =>
        s + Math.max(w.width(w.clean(c.figure), size, "serif"), 66) + 24,
      0,
    );
    if (need <= w.cw) return size;
  }
  return 12;
}

export async function renderPdf(
  doc: ReportDoc,
  p: Provenance,
): Promise<Uint8Array> {
  const cover = doc.cover ?? {};
  const docType = p.docType ?? cover.title ?? doc.title;
  const generated = p.generatedAt.toISOString().slice(0, 10);
  const asOf = longDate(cover.asOf ?? generated);
  const w = await InstitutionalWriter.create({
    title: doc.title,
    subject: doc.subtitle,
    brand: "FactLot",
    mastheadRight: `${docType}  ·  ${asOf}`,
    runningHeader:
      doc.title === docType
        ? docType
        : `${docType}  ·  ${longDates(doc.title)}`,
    footer: p.pdfFooter ?? longDates(p.footer),
    producer: `FactLot ${p.version} reports`,
    keywords: p.keywords,
    created: p.generatedAt,
  });

  // ---- page 1: title block, key figures, and the statements that open the document ----------
  w.titleBlock({
    title: cover.title ?? doc.title,
    line: cover.line ?? doc.subtitle,
    preparedFor: cover.preparedFor,
    asOf,
  });
  const figures = (cover.figures ?? []).slice(0, 4);
  if (figures.length) {
    const cells: Cell[] = figures.map((f) => ({
      figure: f.figure,
      label: f.label,
    }));
    w.band(cells, { figureSize: figureSize(w, cells), accent: true });
  }

  const all = sections(doc.blocks.filter((b) => b.only !== "xlsx"));
  const intro = all.filter((s) => s.heading === undefined);
  const rest = all.filter((s) => s.heading !== undefined);
  const body = rest.filter(
    (s) =>
      !AUDIT_TRAIL.test(s.heading!) &&
      !INPUTS.test(s.heading!) &&
      !PROVENANCE.test(s.heading!),
  );
  const audit = rest.filter((s) => AUDIT_TRAIL.test(s.heading!));
  const prov = rest.filter((s) => PROVENANCE.test(s.heading!));
  const inputs = rest.filter((s) => INPUTS.test(s.heading!));

  // Which blocks a wide table pulls onto landscape pages: it and the text that introduces it.
  const flat: { block: Block; sec: number }[] = [];
  const order = [...intro, ...body, ...audit, ...prov, ...inputs];
  order.forEach((s, i) => {
    if (s.heading !== undefined)
      flat.push({ block: { t: "heading", text: s.heading }, sec: i });
    for (const b of s.blocks) flat.push({ block: b, sec: i });
  });
  const land: boolean[] = [];
  let carry = false;
  for (let i = flat.length - 1; i >= 0; i--) {
    const b = flat[i]!.block;
    if (b.t === "table" || b.t === "kv" || b.t === "pagebreak")
      carry = b.t === "table" && b.columns.length > WIDE_COLUMNS;
    land[i] = carry;
    if (b.t === "heading") carry = false;
  }

  /** Points that must fit under a heading for it to stay with what follows. */
  const keepFor = (b: Block | undefined): number => {
    if (!b) return 40;
    switch (b.t) {
      case "table": {
        const t = prepTable(b);
        return w.dataTableKeep(t.columns, t.rows, t.opts);
      }
      case "kv": {
        const t = prepKv(b);
        return w.dataTableKeep(t.columns, t.rows, t.opts);
      }
      case "para":
        return 2 * 13.5;
      case "bullets":
        return 2 * 13.5;
      case "notice":
        return 3 * 12.7;
      default:
        return 40;
    }
  };

  let n = 0;
  let k = 0;
  const draw = (
    s: Section,
    sectionHeading: string | undefined,
    opts: { appendix?: boolean; basis?: boolean } = {},
  ) => {
    const startK = k;
    if (sectionHeading !== undefined) {
      w.orientation(land[k]!);
      w.section(longDates(sectionHeading), keepFor(s.blocks[0]));
      k++;
    }
    void startK;
    s.blocks.forEach((b, bi) => {
      w.orientation(land[k]!);
      k++;
      switch (b.t) {
        case "heading":
          w.section(longDates(b.text));
          break;
        case "subheading":
          w.subhead(longDates(b.text), keepFor(s.blocks[bi + 1]));
          break;
        case "para": {
          const back = opts.basis || opts.appendix;
          w.para(longDates(b.text), {
            ...(b.grey ? { color: "slate" as const } : {}),
            ...(back ? { size: 8, leading: 11.5 } : {}),
            ...(b.size && b.size < 9 ? { size: b.size + 0.25 } : {}),
            width: TEXT_W,
          });
          break;
        }
        case "notice":
          w.callout(longDates(b.text));
          break;
        case "bullets":
          w.bullets(b.items.map(longDates));
          break;
        case "kv": {
          const t = prepKv(b);
          w.dataTable(t.columns, t.rows, t.opts);
          break;
        }
        case "table": {
          const t = prepTable(
            b,
            opts.appendix ? { mono: true, plainDates: true } : {},
          );
          w.dataTable(t.columns, t.rows, t.opts);
          break;
        }
        case "pagebreak":
          w.pageBreak();
          break;
      }
    });
  };

  // Statements before the first heading (disclaimers, how the values were checked).
  for (const s of intro) draw(s, undefined);
  for (const s of body) {
    n++;
    draw({ ...s }, `${n}. ${s.heading!}`);
  }
  for (const s of audit) draw(s, s.heading);
  for (const s of prov) {
    draw(s, "Basis of preparation", { basis: true });
    w.orientation(false);
    if (cover.note)
      w.para(cover.note, { size: 8, leading: 11.5, color: "slate" });
    w.para(longDates(p.footer), { size: 8, leading: 11.5, color: "slate" });
  }
  if (prov.length === 0) {
    w.section("Basis of preparation");
    if (cover.note)
      w.para(cover.note, { size: 8, leading: 11.5, color: "slate" });
    w.para(longDates(p.footer), { size: 8, leading: 11.5, color: "slate" });
  }
  for (const s of inputs) draw(s, s.heading, { appendix: true });
  return w.bytes();
}
