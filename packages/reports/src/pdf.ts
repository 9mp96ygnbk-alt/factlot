/**
 * A small flowing-layout PDF writer on pdf-lib (pure JavaScript, runs in Workers): title,
 * notices, headings, paragraphs, label/value lists, and tables with wrapped cells and a header
 * row repeated on every page. Every page carries the report's header line, the provenance footer
 * and "Page n of N". Text uses the PDF standard fonts (Helvetica), so nothing is embedded and
 * the file stays small; characters outside their WinAnsi set are written as close ASCII
 * equivalents ("−" as "-", "≥" as ">=") or "?".
 */
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";

import { ReportInputError } from "./validate.ts";

const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const MARGIN = 50;
const HEADER_H = 22;
const FOOTER_H = 34;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const TOP = PAGE_H - MARGIN - HEADER_H;
const BOTTOM = MARGIN + FOOTER_H;

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
  private page!: PDFPage;
  private y = TOP;
  private lines = 0;
  private readonly meta: PdfMeta;
  /** Glyph advance widths at size 1, per font, measured once per character. */
  private readonly advance = new Map<PDFFont, Map<string, number>>();

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

  /** Text the standard fonts can encode. */
  clean(s: string): string {
    let out = "";
    for (const ch of s.replace(/\r\n?/g, "\n").replace(/\t/g, "    ")) {
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

  private newPage(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = TOP;
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
   * measured once). Text over MAX_CELL_CHARS is cut first (capText).
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
        // A word longer than the line is broken by characters; the rest starts the next line.
        line = "";
        lineW = 0;
        for (const ch of word) {
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
      lines.push(line);
    }
    return lines;
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
    this.page.drawText(s, { x, y, size, font, color });
  }

  title(text: string, subtitle?: string): void {
    for (const line of this.wrap(text, 17, CONTENT_W, this.bold)) {
      this.ensure(22);
      this.text(line, MARGIN, this.y - 17, 17, this.bold, NAVY);
      this.y -= 22;
    }
    if (subtitle) {
      for (const line of this.wrap(subtitle, 9.5, CONTENT_W)) {
        this.ensure(13);
        this.text(line, MARGIN, this.y - 10, 9.5, this.regular, GREY);
        this.y -= 13;
      }
    }
    this.y -= 6;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 1,
      color: NAVY,
    });
    this.y -= 10;
  }

  /** A boxed notice: "warn" (red edge) for disclaimers, "info" (green edge) for checks. */
  notice(text: string, tone: "warn" | "info" = "warn", size = 8.5): void {
    const lines = this.wrap(text, size, CONTENT_W - 16);
    const lh = size * 1.3;
    let i = 0;
    while (i < lines.length) {
      this.ensure(lh + 10);
      const fit = Math.max(1, Math.floor((this.y - BOTTOM - 10) / lh));
      const chunk = lines.slice(i, i + fit);
      const h = chunk.length * lh + 10;
      this.page.drawRectangle({
        x: MARGIN,
        y: this.y - h,
        width: CONTENT_W,
        height: h,
        color: tone === "warn" ? NOTICE_FILL : INFO_FILL,
      });
      this.page.drawRectangle({
        x: MARGIN,
        y: this.y - h,
        width: 3,
        height: h,
        color: tone === "warn" ? NOTICE_EDGE : INFO_EDGE,
      });
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

  heading(text: string): void {
    // Keep a heading with at least a few lines of what follows.
    this.ensure(60);
    this.y -= 6;
    for (const line of this.wrap(text, 12, CONTENT_W, this.bold)) {
      this.text(line, MARGIN, this.y - 12, 12, this.bold, NAVY);
      this.y -= 16;
    }
    this.y -= 2;
  }

  subheading(text: string): void {
    this.ensure(40);
    for (const line of this.wrap(text, 10, CONTENT_W, this.bold)) {
      this.text(line, MARGIN, this.y - 10, 10, this.bold);
      this.y -= 13;
    }
    this.y -= 1;
  }

  para(
    text: string,
    opts: { size?: number; color?: "ink" | "grey"; bold?: boolean } = {},
  ): void {
    const size = opts.size ?? 9;
    const font = opts.bold ? this.bold : this.regular;
    const lh = size * 1.35;
    for (const line of this.wrap(text, size, CONTENT_W, font)) {
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
      const lines = this.wrap(item, size, CONTENT_W - 12);
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

  table(
    columns: Column[],
    rows: string[][],
    opts: TableOptions & { headerless?: boolean } = {},
  ): void {
    const size = opts.size ?? 8;
    const hsize = opts.headerSize ?? size;
    const lh = size * 1.3;
    const pad = 3;
    const total = columns.reduce((s, c) => s + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * CONTENT_W);
    const xs = widths.map(
      (_, i) => MARGIN + widths.slice(0, i).reduce((s, w) => s + w, 0),
    );
    const cellLines = (row: string[], font: PDFFont, sz: number) =>
      row.map((cell, i) =>
        this.wrap(cell ?? "", sz, widths[i]! - 2 * pad, font),
      );

    const drawRow = (
      lines: string[][],
      font: PDFFont,
      sz: number,
      fill?: RGB,
      color: RGB = INK,
    ) => {
      const h = Math.max(1, ...lines.map((l) => l.length)) * sz * 1.3 + 2 * pad;
      if (fill)
        this.page.drawRectangle({
          x: MARGIN,
          y: this.y - h,
          width: CONTENT_W,
          height: h,
          color: fill,
        });
      lines.forEach((ls, i) => {
        const align = columns[i]!.align ?? "left";
        ls.forEach((line, k) => {
          const w = this.width(line, sz, font);
          const x =
            align === "right" ? xs[i]! + widths[i]! - pad - w : xs[i]! + pad;
          this.text(
            line,
            x,
            this.y - pad - (k + 1) * sz * 1.3 + sz * 0.3,
            sz,
            font,
            color,
          );
        });
      });
      this.y -= h;
      return h;
    };
    const header = () => {
      if (opts.headerless) return;
      const lines = cellLines(
        columns.map((c) => c.header),
        this.bold,
        hsize,
      );
      const h =
        Math.max(1, ...lines.map((l) => l.length)) * hsize * 1.3 + 2 * pad;
      this.ensure(h + lh + 2 * pad);
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
      tableHeight < (TOP - BOTTOM) * 0.45 &&
      this.y < TOP - 1
    )
      this.newPage();
    header();
    rows.forEach((row, r) => {
      const font = opts.bold?.has(r) ? this.bold : this.regular;
      const lines = cellLines(row, font, size);
      const h = Math.max(1, ...lines.map((l) => l.length)) * lh + 2 * pad;
      if (this.y - h < BOTTOM) {
        if (h > TOP - BOTTOM - 40) {
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
            );
            start += fit;
          }
          return;
        }
        this.newPage();
        header();
      }
      drawRow(lines, font, size, r % 2 ? BAND : undefined);
    });
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.5,
      color: RULE,
    });
    this.y -= 10;
  }

  spacer(h = 6): void {
    this.y -= h;
  }

  pageBreak(): void {
    this.newPage();
  }

  async bytes(): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    const footerLines = this.wrap(this.meta.footer, 6.5, CONTENT_W - 60);
    pages.forEach((p, i) => {
      this.page = p;
      this.text(
        this.clean(this.meta.header),
        MARGIN,
        PAGE_H - MARGIN - 8,
        7.5,
        this.regular,
        GREY,
      );
      p.drawLine({
        start: { x: MARGIN, y: PAGE_H - MARGIN - 13 },
        end: { x: PAGE_W - MARGIN, y: PAGE_H - MARGIN - 13 },
        thickness: 0.5,
        color: RULE,
      });
      p.drawLine({
        start: { x: MARGIN, y: MARGIN + FOOTER_H - 8 },
        end: { x: PAGE_W - MARGIN, y: MARGIN + FOOTER_H - 8 },
        thickness: 0.5,
        color: RULE,
      });
      footerLines
        .slice(0, 3)
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
        PAGE_W - MARGIN - this.width(label, 7.5, this.regular),
        MARGIN + FOOTER_H - 17,
        7.5,
        this.regular,
        GREY,
      );
    });
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
