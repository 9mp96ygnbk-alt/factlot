/**
 * A small flowing-layout PDF writer on pdf-lib (pure JavaScript, runs in Workers): title,
 * notices, headings, paragraphs, label/value lists, and tables with wrapped cells and a header
 * row repeated on every page. Every page carries the report's header line, the provenance footer
 * and "Page n of N". Text uses the PDF standard fonts (Helvetica), so nothing is embedded and
 * the file stays small; characters outside their WinAnsi set are written as close ASCII
 * equivalents ("−" as "-", "≥" as ">=") or "?".
 *
 * Page content is written as PDF operator text, one short string per line or shape, and turned
 * into one compressed stream per page at the end: pdf-lib's drawing calls build about ten
 * objects per line of text, which for a long table cost tens of megabytes.
 */
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";

import { stripControls } from "./format.ts";
import { ReportInputError } from "./validate.ts";

const PAGE_W = 612; // US Letter, portrait; a landscape page swaps the two
const PAGE_H = 792;
const MARGIN = 50;
const HEADER_H = 22;
const FOOTER_H = 34;
const BOTTOM = MARGIN + FOOTER_H;
/** Smallest text a table shrinks to so its numbers fit their columns. */
const MIN_TABLE_SIZE = 5.5;
/** A table with more columns than this is laid out on landscape pages. */
export const WIDE_TABLE_COLUMNS = 10;
/** A number as a cell shows it: never broken across lines. */
const NUMERIC = /^[-+(]?-?\$?-?[\d,]*\.?\d+(?:%|x|\/SF|\))?$/;
/** Characters after which a long word may break (identifiers, URLs, paths). */
const BREAK_AFTER = /(?<=[_\-/.:;,?&=#@|])/;
const URL = /^https?:\/\/\S+$/;
/** An ISO date, kept on one line. */
const DATE = /^\d{4}-\d{2}-\d{2}[,;.)]?$/;

const INK = rgb(0.1, 0.1, 0.12);
const GREY = rgb(0.38, 0.38, 0.42);
const NAVY = rgb(0.122, 0.22, 0.392);
const BAND = rgb(0.955, 0.958, 0.965);
const RULE = rgb(0.8, 0.81, 0.84);
const NOTICE_FILL = rgb(0.992, 0.937, 0.89);
const NOTICE_EDGE = rgb(0.75, 0.0, 0.0);
const INFO_FILL = rgb(0.91, 0.95, 0.89);
const INFO_EDGE = rgb(0.33, 0.51, 0.21);

/** Longest text drawn from one cell or paragraph; longer text is cut with a note. */
export const MAX_CELL_CHARS = 2_000;
/** A number as PDF operator text: at most three decimals, never an exponent. */
const n = (x: number): string => {
  const s = (Math.round(x * 1000) / 1000).toFixed(3).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
};
const rgbOp = (c: RGB): string => `${n(c.red)} ${n(c.green)} ${n(c.blue)}`;

/** Most lines of text one document draws (an ASC 842 schedule of 1,200 periods draws ~12,000). */
export const MAX_PDF_LINES = 60_000;

/** Text cut to MAX_CELL_CHARS, with an ellipsis and a note saying how much there was. */
export function capText(s: string): string {
  if (s.length <= MAX_CELL_CHARS) return s;
  return `${s.slice(0, MAX_CELL_CHARS)}… [cut: ${s.length.toLocaleString("en-US")} characters in all; the PDF shows the first ${MAX_CELL_CHARS.toLocaleString("en-US")}]`;
}

/** Unicode → WinAnsi-safe text. */
const REPLACE: Record<string, string> = {
  "\u2212": "-",
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2264": "<=",
  "\u2265": ">=",
  "\u2260": "!=",
  "\u2248": "~",
  "\u2192": "->",
  "\u2190": "<-",
  "\u21d2": "=>",
  "\u03a3": "Sum ",
  "\u2211": "Sum ",
  "\u03a0": "Product ",
  "\u220f": "Product ",
  "\u221a": "sqrt",
  "\u2032": "'",
  "\u2033": '"',
  "\u2009": " ",
  "\u200a": " ",
  "\u2002": " ",
  "\u2003": " ",
  "\u202f": " ",
  "\u2007": " ",
  "\u200b": "",
  "\ufeff": "",
  "\u2713": "v",
  "\u2717": "x",
  "\u00ad": "",
  "\u230a": "floor(",
  "\u230b": ")",
  "\u2308": "ceil(",
  "\u2309": ")",
  "\u221e": "infinity",
};

export type Align = "left" | "right";

export interface Column {
  header: string;
  /** Share of the content width; the shares are scaled to fill it. */
  width: number;
  align?: Align;
}

export interface TableOptions {
  size?: number;
  /** Row indexes drawn in bold (totals, medians). */
  bold?: Set<number>;
  /** Header text size (default: the body size). */
  headerSize?: number;
}

export interface PdfMeta {
  title: string;
  subject: string;
  /** Left side of each page's header line. */
  header: string;
  /** The provenance line printed at the foot of every page. */
  footer: string;
  producer: string;
  keywords: string[];
  created: Date;
}

export class PdfWriter {
  private doc!: PDFDocument;
  private regular!: PDFFont;
  private bold!: PDFFont;
  private charset!: Set<number>;
  /** The page being written and its content operators. */
  private cur!: Page;
  private readonly pages: Page[] = [];
  private y = PAGE_H - MARGIN - HEADER_H;
  private lines = 0;
  private readonly meta: PdfMeta;
  /** Glyph advance widths at size 1, per font, measured once per character. */
  private readonly advance = new Map<PDFFont, Map<string, number>>();
  /** The last heading drawn, while nothing has been drawn after it (keep-with-next). */
  private lastHeading:
    { page: Page; from: number; to: number; redraw: () => void } | undefined;

  private constructor(meta: PdfMeta) {
    this.meta = meta;
  }

  static async create(meta: PdfMeta): Promise<PdfWriter> {
    const w = new PdfWriter(meta);
    w.doc = await PDFDocument.create({ updateMetadata: false });
    w.regular = await w.doc.embedFont(StandardFonts.Helvetica);
    w.bold = await w.doc.embedFont(StandardFonts.HelveticaBold);
    w.charset = new Set(w.regular.getCharacterSet());
    w.newPage();
    return w;
  }

  /** The current page's width, height, content width and top of content. */
  private get pw(): number {
    return this.cur.w;
  }
  private get cw(): number {
    return this.cur.w - 2 * MARGIN;
  }
  private get top(): number {
    return this.cur.h - MARGIN - HEADER_H;
  }

  /** Text the standard fonts can encode. */
  clean(s: string): string {
    let out = "";
    for (const ch of stripControls(s.replace(/\r\n?/g, "\n")).replace(
      /\t/g,
      "    ",
    )) {
      const cp = ch.codePointAt(0)!;
      if (ch === "\n" || this.charset.has(cp)) out += ch;
      else if (REPLACE[ch] !== undefined) out += REPLACE[ch];
      else {
        const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
        out +=
          [...base].every((c) => this.charset.has(c.codePointAt(0)!)) && base
            ? base
            : "?";
      }
    }
    return out;
  }

  private newPage(landscape = this.cur?.landscape ?? false): void {
    const [w, h] = landscape ? [PAGE_H, PAGE_W] : [PAGE_W, PAGE_H];
    this.cur = {
      page: this.doc.addPage([w, h]),
      ops: [],
      links: [],
      w,
      h,
      landscape,
    };
    this.pages.push(this.cur);
    this.y = this.top;
  }

  /**
   * Continue on pages of this orientation: a new page when it changes, unless the current page
   * is still empty (then it is replaced).
   */
  orientation(landscape: boolean): void {
    if (this.cur.landscape === landscape) return;
    if (this.cur.ops.length === 0 && this.y >= this.top - 0.5) {
      this.doc.removePage(this.pages.length - 1);
      this.pages.pop();
    }
    this.newPage(landscape);
  }

  /** A filled rectangle. */
  private rect(x: number, y: number, w: number, h: number, color: RGB): void {
    this.cur.ops.push(
      `${rgbOp(color)} rg ${n(x)} ${n(y)} ${n(w)} ${n(h)} re f`,
    );
  }

  /** A stroked line. */
  private line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    thickness: number,
    color: RGB,
  ): void {
    this.cur.ops.push(
      `${rgbOp(color)} RG ${n(thickness)} w ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`,
    );
  }

  private ensure(h: number): void {
    if (this.y - h < BOTTOM) this.newPage();
  }

  /** One character's advance at size 1 (the PDF draws glyphs without kerning). */
  private charWidth(ch: string, font: PDFFont): number {
    let m = this.advance.get(font);
    if (!m) this.advance.set(font, (m = new Map()));
    let w = m.get(ch);
    if (w === undefined) {
      w = font.widthOfTextAtSize(ch, 1);
      m.set(ch, w);
    }
    return w;
  }

  /** Width of cleaned text: the sum of its glyphs' advances, in one pass. */
  private width(s: string, size: number, font: PDFFont): number {
    let w = 0;
    for (const ch of s) w += this.charWidth(ch, font);
    return w * size;
  }

  /**
   * Wrap text into lines no wider than `w`, in one pass over its characters (each glyph is
   * measured once). Lines break at spaces; a word longer than the line breaks after a
   * separator (_ - / . : and the like), and only a piece still too long breaks by characters.
   * Text over MAX_CELL_CHARS is cut first (capText).
   */
  wrap(
    text: string,
    size: number,
    w: number,
    font: PDFFont = this.regular,
  ): string[] {
    const lines: string[] = [];
    const space = this.charWidth(" ", font) * size;
    for (const para of this.clean(capText(text)).split("\n")) {
      if (para === "") {
        lines.push("");
        continue;
      }
      let line = "";
      let lineW = 0;
      for (const word of para.split(/ +/)) {
        const wordW = this.width(word, size, font);
        if (line && lineW + space + wordW <= w) {
          line += ` ${word}`;
          lineW += space + wordW;
          continue;
        }
        if (line) lines.push(line);
        if (wordW <= w) {
          line = word;
          lineW = wordW;
          continue;
        }
        // A word longer than the line: break after separators, then by characters.
        line = "";
        lineW = 0;
        for (const piece of word.split(BREAK_AFTER)) {
          const pw = this.width(piece, size, font);
          if (lineW + pw <= w) {
            line += piece;
            lineW += pw;
            continue;
          }
          if (line) lines.push(line);
          line = "";
          lineW = 0;
          if (pw <= w) {
            line = piece;
            lineW = pw;
            continue;
          }
          for (const ch of piece) {
            const cw = this.charWidth(ch, font) * size;
            if (line && lineW + cw > w) {
              lines.push(line);
              line = "";
              lineW = 0;
            }
            line += ch;
            lineW += cw;
          }
        }
      }
      lines.push(line);
    }
    return lines;
  }

  /** The widest piece of text that may not be broken: a number whole, else a word's pieces. */
  private unbreakable(
    text: string,
    size: number,
    font: PDFFont,
    numeric: boolean,
  ): number {
    const t = this.clean(capText(text));
    if (numeric && NUMERIC.test(t)) return this.width(t, size, font);
    let m = 0;
    for (const word of t.split(/[ \n]+/))
      for (const piece of DATE.test(word) ? [word] : word.split(BREAK_AFTER))
        m = Math.max(m, this.width(piece, size, font));
    return m;
  }

  private text(
    s: string,
    x: number,
    y: number,
    size: number,
    font: PDFFont,
    color: RGB = INK,
  ): void {
    if (!s) return;
    if (++this.lines > MAX_PDF_LINES)
      throw new ReportInputError(
        "TooLarge",
        `the PDF would draw more than ${MAX_PDF_LINES.toLocaleString("en-US")} lines of text; ask for the xlsx format, or send less text`,
      );
    const key = font === this.bold ? "F2" : "F1";
    this.cur.ops.push(
      `${rgbOp(color)} rg BT /${key} ${n(size)} Tf ${n(x)} ${n(y)} Td ${font.encodeText(s).toString()} Tj ET`,
    );
  }

  /** A clickable link over a rectangle of the current page. */
  private link(x: number, y: number, w: number, h: number, uri: string): void {
    this.cur.links.push({ rect: [x, y, x + w, y + h], uri });
  }

  title(text: string, subtitle?: string): void {
    for (const line of this.wrap(text, 17, this.cw, this.bold)) {
      this.ensure(22);
      this.text(line, MARGIN, this.y - 17, 17, this.bold, NAVY);
      this.y -= 22;
    }
    if (subtitle) {
      for (const line of this.wrap(subtitle, 9.5, this.cw)) {
        this.ensure(13);
        this.text(line, MARGIN, this.y - 10, 9.5, this.regular, GREY);
        this.y -= 13;
      }
    }
    this.y -= 6;
    this.line(MARGIN, this.y, this.pw - MARGIN, this.y, 1, NAVY);
    this.y -= 10;
  }

  /** A boxed notice: "warn" (red edge) for disclaimers, "info" (green edge) for checks. */
  notice(text: string, tone: "warn" | "info" = "warn", size = 8.5): void {
    const lines = this.wrap(text, size, this.cw - 16);
    const lh = size * 1.3;
    let i = 0;
    while (i < lines.length) {
      this.ensure(lh + 10);
      const fit = Math.max(1, Math.floor((this.y - BOTTOM - 10) / lh));
      const chunk = lines.slice(i, i + fit);
      const h = chunk.length * lh + 10;
      this.rect(
        MARGIN,
        this.y - h,
        this.cw,
        h,
        tone === "warn" ? NOTICE_FILL : INFO_FILL,
      );
      this.rect(
        MARGIN,
        this.y - h,
        3,
        h,
        tone === "warn" ? NOTICE_EDGE : INFO_EDGE,
      );
      chunk.forEach((l, k) =>
        this.text(
          l,
          MARGIN + 10,
          this.y - 5 - (k + 1) * lh + 2.5,
          size,
          this.regular,
        ),
      );
      this.y -= h + 8;
      i += chunk.length;
    }
  }

  /**
   * Height a heading needs below it: `keep` points of what follows stay on its page (the
   * caller passes the first block's height when it knows it).
   */
  heading(text: string, keep = 60): void {
    const lines = this.wrap(text, 12, this.cw, this.bold);
    this.ensure(8 + lines.length * 16 + keep);
    const from = this.cur.ops.length;
    this.y -= 6;
    for (const line of lines) {
      this.text(line, MARGIN, this.y - 12, 12, this.bold, NAVY);
      this.y -= 16;
    }
    this.y -= 2;
    this.markHeading(from, () => this.heading(text, keep));
  }

  subheading(text: string, keep = 40): void {
    const lines = this.wrap(text, 10, this.cw, this.bold);
    this.ensure(lines.length * 13 + keep);
    const from = this.cur.ops.length;
    for (const line of lines) {
      this.text(line, MARGIN, this.y - 10, 10, this.bold);
      this.y -= 13;
    }
    this.y -= 1;
    this.markHeading(from, () => this.subheading(text, keep));
  }

  private markHeading(from: number, redraw: () => void): void {
    this.lastHeading = {
      page: this.cur,
      from,
      to: this.cur.ops.length,
      redraw,
    };
  }

  /**
   * Start a new page; a heading drawn just before (with nothing after it) moves along, so a
   * heading is never left alone at the foot of a page.
   */
  private newPageKeepingHeading(): void {
    const h = this.lastHeading;
    if (h && h.page === this.cur && h.to === this.cur.ops.length) {
      this.cur.ops.splice(h.from);
      this.lastHeading = undefined;
      this.newPage();
      h.redraw();
    } else this.newPage();
  }

  para(
    text: string,
    opts: { size?: number; color?: "ink" | "grey"; bold?: boolean } = {},
  ): void {
    const size = opts.size ?? 9;
    const font = opts.bold ? this.bold : this.regular;
    const lh = size * 1.35;
    for (const line of this.wrap(text, size, this.cw, font)) {
      this.ensure(lh);
      this.text(
        line,
        MARGIN,
        this.y - size,
        size,
        font,
        opts.color === "grey" ? GREY : INK,
      );
      this.y -= lh;
    }
    this.y -= 4;
  }

  bullets(items: string[], size = 9): void {
    const lh = size * 1.35;
    for (const item of items) {
      const lines = this.wrap(item, size, this.cw - 12);
      lines.forEach((line, k) => {
        this.ensure(lh);
        if (k === 0)
          this.text("-", MARGIN + 2, this.y - size, size, this.regular, GREY);
        this.text(line, MARGIN + 12, this.y - size, size, this.regular);
        this.y -= lh;
      });
      this.y -= 1.5;
    }
    this.y -= 3;
  }

  /** Label / value rows; values right-aligned in a column. */
  kv(
    rows: [string, string][],
    opts: { size?: number; labelShare?: number } = {},
  ): void {
    this.table(
      [
        { header: "", width: opts.labelShare ?? 0.58 },
        { header: "", width: 1 - (opts.labelShare ?? 0.58), align: "right" },
      ],
      rows,
      { size: opts.size ?? 9, headerless: true },
    );
  }

  /**
   * Column widths and a text size at which every number fits its column on one line and every
   * word (or separator-delimited piece of one) fits its column: the shares are the starting
   * point, columns that need more take it from columns with room, and when the page is too
   * narrow for all of them the text shrinks (down to MIN_TABLE_SIZE).
   */
  private layout(
    columns: Column[],
    rows: string[][],
    size: number,
    hsize: number,
    pad: number,
    headerless: boolean,
  ): { widths: number[]; size: number; hsize: number } {
    const cw = this.cw;
    const total = columns.reduce((s, c) => s + c.width, 0);
    const desired = columns.map((c) => (c.width / total) * cw);
    const need = (sz: number, hsz: number) =>
      columns.map((c, i) => {
        const numeric = c.align === "right";
        let m = headerless
          ? 0
          : this.unbreakable(c.header, hsz, this.bold, false);
        for (const row of rows)
          m = Math.max(
            m,
            this.unbreakable(row[i] ?? "", sz, this.bold, numeric),
          );
        // A text column never claims more than 40% of the page for one long token.
        return Math.min(m + 2 * pad + 0.5, numeric ? cw : cw * 0.4);
      });
    let sz = size;
    let hsz = hsize;
    let min = need(sz, hsz);
    let sum = min.reduce((s, x) => s + x, 0);
    if (sum > cw) {
      const k = Math.max(MIN_TABLE_SIZE / sz, (cw / sum) * 0.98);
      sz = Math.max(MIN_TABLE_SIZE, sz * k);
      hsz = Math.max(MIN_TABLE_SIZE, hsz * k);
      min = need(sz, hsz);
      sum = min.reduce((s, x) => s + x, 0);
    }
    if (sum > cw) {
      // Still too wide at the smallest size: share the page by need.
      return { widths: min.map((m) => (m / sum) * cw), size: sz, hsize: hsz };
    }
    const widths = desired.map((d, i) => Math.max(d, min[i]!));
    const excess = widths.reduce((s, x) => s + x, 0) - cw;
    if (excess > 0) {
      const slack = widths.map((w, i) => w - min[i]!);
      const room = slack.reduce((s, x) => s + x, 0);
      for (let i = 0; i < widths.length; i++)
        widths[i] = widths[i]! - (excess * slack[i]!) / room;
    }
    return { widths, size: sz, hsize: hsz };
  }

  table(
    columns: Column[],
    rows: string[][],
    opts: TableOptions & { headerless?: boolean } = {},
  ): void {
    const pad = 3;
    const fit = this.layout(
      columns,
      rows,
      opts.size ?? 8,
      opts.headerSize ?? opts.size ?? 8,
      pad,
      opts.headerless ?? false,
    );
    const size = fit.size;
    const hsize = fit.hsize;
    const lh = size * 1.3;
    const widths = fit.widths;
    const xs = widths.map(
      (_, i) => MARGIN + widths.slice(0, i).reduce((s, w) => s + w, 0),
    );
    /** A number in a right-aligned column is one line, shrunk if it still does not fit. */
    const isNumber = (i: number, cell: string) =>
      columns[i]!.align === "right" && NUMERIC.test(this.clean(cell));
    const cellLines = (row: string[], font: PDFFont, sz: number) =>
      row.map((cell, i) =>
        isNumber(i, cell ?? "")
          ? [this.clean(cell)]
          : this.wrap(cell ?? "", sz, widths[i]! - 2 * pad, font),
      );

    const drawRow = (
      lines: string[][],
      font: PDFFont,
      sz: number,
      fill?: RGB,
      color: RGB = INK,
      raw?: string[],
    ) => {
      const h = Math.max(1, ...lines.map((l) => l.length)) * sz * 1.3 + 2 * pad;
      if (fill) this.rect(MARGIN, this.y - h, this.cw, h, fill);
      lines.forEach((ls, i) => {
        const align = columns[i]!.align ?? "left";
        const room = widths[i]! - 2 * pad;
        const uri =
          raw && URL.test((raw[i] ?? "").trim()) ? raw[i]!.trim() : "";
        ls.forEach((line, k) => {
          let csz = sz;
          let w = this.width(line, csz, font);
          if (w > room && ls.length === 1 && isNumber(i, line)) {
            csz = (sz * room) / w;
            w = room;
          }
          const x =
            align === "right" ? xs[i]! + widths[i]! - pad - w : xs[i]! + pad;
          const baseline = this.y - pad - (k + 1) * sz * 1.3 + sz * 0.3;
          this.text(line, x, baseline, csz, font, uri ? NAVY : color);
          if (uri && line) this.link(x, baseline - sz * 0.25, w, sz * 1.2, uri);
        });
      });
      this.y -= h;
      return h;
    };
    const header = () => {
      if (opts.headerless) return;
      const lines = columns.map((c, i) =>
        this.wrap(c.header, hsize, widths[i]! - 2 * pad, this.bold),
      );
      const h =
        Math.max(1, ...lines.map((l) => l.length)) * hsize * 1.3 + 2 * pad;
      if (this.y - (h + lh + 2 * pad) < BOTTOM) this.newPageKeepingHeading();
      drawRow(lines, this.bold, hsize, NAVY, rgb(1, 1, 1));
    };
    // Keep a short table together: start it on a new page rather than split a few rows off.
    const heights = rows.map((row, r) => {
      const ls = cellLines(
        row,
        opts.bold?.has(r) ? this.bold : this.regular,
        size,
      );
      return Math.max(1, ...ls.map((l) => l.length)) * lh + 2 * pad;
    });
    const tableHeight =
      heights.reduce((s, h) => s + h, 0) +
      (opts.headerless ? 0 : hsize * 2.6 + 2 * pad);
    if (
      this.y - tableHeight < BOTTOM &&
      tableHeight < (this.top - BOTTOM) * 0.45 &&
      this.y < this.top - 1
    )
      this.newPageKeepingHeading();
    header();
    rows.forEach((row, r) => {
      const font = opts.bold?.has(r) ? this.bold : this.regular;
      const lines = cellLines(row, font, size);
      const h = Math.max(1, ...lines.map((l) => l.length)) * lh + 2 * pad;
      if (this.y - h < BOTTOM) {
        if (h > this.top - BOTTOM - 40) {
          // A row taller than a page: split its lines over pages.
          let start = 0;
          const max = Math.max(...lines.map((l) => l.length));
          while (start < max) {
            if (this.y - lh - 2 * pad < BOTTOM) {
              this.newPage();
              header();
            }
            const fit = Math.max(
              1,
              Math.floor((this.y - BOTTOM - 2 * pad) / lh),
            );
            drawRow(
              lines.map((l) => l.slice(start, start + fit)),
              font,
              size,
              r % 2 ? BAND : undefined,
              INK,
              row,
            );
            start += fit;
          }
          return;
        }
        this.newPage();
        header();
      }
      drawRow(lines, font, size, r % 2 ? BAND : undefined, INK, row);
    });
    this.line(MARGIN, this.y, this.pw - MARGIN, this.y, 0.5, RULE);
    this.y -= 10;
  }

  spacer(h = 6): void {
    this.y -= h;
  }

  pageBreak(): void {
    this.newPage();
  }

  /** Space left on the current page, in points. */
  get room(): number {
    return this.y - BOTTOM;
  }

  async bytes(): Promise<Uint8Array> {
    const pages = this.pages;
    pages.forEach((p, i) => {
      this.cur = p;
      const footerLines = this.wrap(this.meta.footer, 6.5, this.cw - 60);
      this.text(
        this.clean(this.meta.header),
        MARGIN,
        p.h - MARGIN - 8,
        7.5,
        this.regular,
        GREY,
      );
      this.line(
        MARGIN,
        p.h - MARGIN - 13,
        p.w - MARGIN,
        p.h - MARGIN - 13,
        0.5,
        RULE,
      );
      this.line(
        MARGIN,
        MARGIN + FOOTER_H - 8,
        p.w - MARGIN,
        MARGIN + FOOTER_H - 8,
        0.5,
        RULE,
      );
      footerLines
        .slice(0, 4)
        .forEach((l, k) =>
          this.text(
            l,
            MARGIN,
            MARGIN + FOOTER_H - 17 - k * 8.5,
            6.5,
            this.regular,
            GREY,
          ),
        );
      const label = `Page ${i + 1} of ${pages.length}`;
      this.text(
        label,
        p.w - MARGIN - this.width(label, 7.5, this.regular),
        MARGIN + FOOTER_H - 17,
        7.5,
        this.regular,
        GREY,
      );
    });
    const ctx = this.doc.context;
    for (const p of pages) {
      p.page.node.setFontDictionary(PDFName.of("F1"), this.regular.ref);
      p.page.node.setFontDictionary(PDFName.of("F2"), this.bold.ref);
      p.page.node.addContentStream(
        ctx.register(ctx.flateStream(p.ops.join("\n"))),
      );
      p.ops = [];
      if (p.links.length) {
        const annots = ctx.obj([]) as PDFArray;
        for (const l of p.links)
          annots.push(
            ctx.register(
              ctx.obj({
                Type: "Annot",
                Subtype: "Link",
                Rect: l.rect.map((x) => Math.round(x * 100) / 100),
                Border: [0, 0, 0],
                A: {
                  Type: "Action",
                  S: "URI",
                  URI: PDFString.of(l.uri),
                },
              }),
            ),
          );
        p.page.node.set(PDFName.of("Annots"), annots);
      }
    }
    const m = this.meta;
    this.doc.setTitle(this.clean(m.title), { showInWindowTitleBar: true });
    this.doc.setSubject(this.clean(m.subject));
    this.doc.setAuthor("FactLot");
    this.doc.setCreator(this.clean(m.producer));
    this.doc.setProducer(this.clean(m.producer));
    this.doc.setKeywords(m.keywords.map((k) => this.clean(k)));
    this.doc.setCreationDate(m.created);
    this.doc.setModificationDate(m.created);
    return this.doc.save({ useObjectStreams: false });
  }
}

interface Page {
  page: PDFPage;
  ops: string[];
  links: { rect: number[]; uri: string }[];
  w: number;
  h: number;
  landscape: boolean;
}
