import {
  type ArtifactExporter,
  type ExportContext,
  isSafeLink,
  mixHex,
  type Theme,
  themeBrand,
} from '@artkit-ai/core';
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  convertMillimetersToTwip,
  Document,
  ExternalHyperlink,
  type FileChild,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  LevelFormat,
  LineRuleType,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  type ParagraphChild,
  ShadingType,
  Table,
  TableBorders,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import {
  type Block,
  type CalloutBlock,
  type DocumentContent,
  type ImageBlock,
  type ListBlock,
  type ListItem,
  PAGE_SIZES_MM,
  pageGeometry,
  type Run,
  type TableBlock,
} from '../schema.js';
import { DEFAULT_TOC_LEVEL } from '../toc.js';
import { resolveImages } from './html.js';
import { imageSize } from './image-size.js';

type Alignment = (typeof AlignmentType)[keyof typeof AlignmentType];

const hex = (color: string) => color.replace('#', '').toUpperCase();

/** Mixes a color with white (`amount` of the color), for callout backgrounds. */
function tint(color: string, amount: number): string {
  const value = hex(color);
  const channel = (i: number) => {
    const c = Number.parseInt(value.slice(i, i + 2), 16);
    return Math.round(255 - (255 - c) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `${channel(0)}${channel(2)}${channel(4)}`.toUpperCase();
}

const ALIGN: Record<string, Alignment> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
] as const;
const BULLETS = ['•', '◦', '▪'];
const PX_PER_MM = 96 / 25.4;
const DOCX_IMAGE_TYPES: Record<string, 'png' | 'jpg' | 'gif'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
};

interface Env {
  ctx: ExportContext;
  theme: Theme;
  content: DocumentContent;
  bookmarks: Map<string, string>;
  images: Map<string, { bytes: Uint8Array; mimeType: string }>;
  textWidthMm: number;
  numbering: { reference: string; levels: ReturnType<typeof levelDefinitions> }[];
  warned: Set<string>;
}

function warnOnce(env: Env, key: string, message: string): void {
  if (env.warned.has(key)) return;
  env.warned.add(key);
  env.ctx.warn(message);
}

/** Word bookmark names: start with a letter, letters/digits/underscore, at most 40 characters. */
function bookmarkNames(blocks: readonly Block[]): Map<string, string> {
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const block of blocks) {
    const base = `ak_${block.id.replace(/[^A-Za-z0-9_]/g, '_')}`.slice(0, 36);
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}_${n}`;
    used.add(name);
    names.set(block.id, name);
  }
  return names;
}

function textRuns(
  run: Run,
  env: Env,
  overrides: { color?: string; bold?: boolean; italics?: boolean; size?: number } = {},
): TextRun[] {
  const { theme } = env;
  return run.text.split('\n').map(
    (line, index) =>
      new TextRun({
        text: line,
        ...(index > 0 ? { break: 1 } : {}),
        ...((overrides.bold ?? run.bold) ? { bold: true } : {}),
        ...((overrides.italics ?? run.italic) ? { italics: true } : {}),
        ...(run.underline || run.link ? { underline: {} } : {}),
        ...(run.strike ? { strike: true } : {}),
        ...(run.superscript ? { superScript: true } : {}),
        ...(run.subscript ? { subScript: true } : {}),
        ...(run.code
          ? {
              font: theme.fonts.mono,
              shading: { type: ShadingType.CLEAR, fill: hex(theme.colors.surface), color: 'auto' },
            }
          : {}),
        ...(run.link
          ? { color: hex(theme.colors.accent) }
          : overrides.color
            ? { color: overrides.color }
            : {}),
        ...(overrides.size ? { size: overrides.size } : {}),
      }),
  );
}

/** Runs as paragraph children, grouping consecutive runs with the same link into one hyperlink. */
function runChildren(
  runs: readonly Run[],
  env: Env,
  overrides?: Parameters<typeof textRuns>[2],
): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  let index = 0;
  while (index < runs.length) {
    const run = runs[index]!;
    const link = run.link && isSafeLink(run.link) ? run.link.trim() : undefined;
    if (!link) {
      out.push(...textRuns(run, env, overrides));
      index++;
      continue;
    }
    const group: TextRun[] = [];
    while (index < runs.length && runs[index]!.link?.trim() === link)
      group.push(...textRuns(runs[index++]!, env, overrides));
    if (link.startsWith('#')) {
      const anchor = env.bookmarks.get(link.slice(1));
      if (anchor) out.push(new InternalHyperlink({ anchor, children: group }));
      else out.push(...group);
    } else {
      out.push(new ExternalHyperlink({ link, children: group }));
    }
  }
  return out;
}

function levelDefinitions(formats: boolean[], start: number) {
  return formats.map((ordered, level) => ({
    level,
    format: ordered
      ? [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level]!
      : LevelFormat.BULLET,
    text: ordered ? `%${level + 1}.` : BULLETS[level]!,
    start: level === 0 ? start : 1,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
}

/** Numbering of each nesting level: the list's own, then the first `childrenOrdered` found at that depth. */
function listFormats(block: ListBlock): boolean[] {
  const formats = [Boolean(block.ordered), Boolean(block.ordered), Boolean(block.ordered)];
  const visit = (items: readonly ListItem[], depth: number, inherited: boolean, seen: Set<number>) => {
    for (const item of items) {
      if (!item.children?.length || depth + 1 > 2) continue;
      const ordered = item.childrenOrdered ?? inherited;
      if (!seen.has(depth + 1)) {
        formats[depth + 1] = ordered;
        seen.add(depth + 1);
      }
      visit(item.children, depth + 1, ordered, seen);
    }
  };
  visit(block.items, 0, Boolean(block.ordered), new Set());
  return formats;
}

function listParagraphs(block: ListBlock, env: Env): Paragraph[] {
  const reference = `ak-list-${env.numbering.length + 1}`;
  env.numbering.push({ reference, levels: levelDefinitions(listFormats(block), block.start ?? 1) });
  const out: Paragraph[] = [];
  const walk = (items: readonly ListItem[], level: number) => {
    for (const item of items) {
      out.push(
        new Paragraph({
          numbering: { reference, level },
          children: runChildren(item.runs, env),
          spacing: { after: 60 },
        }),
      );
      if (item.children?.length) walk(item.children, Math.min(level + 1, 2));
    }
  };
  walk(block.items, 0);
  return out;
}

function tableBlock(block: TableBlock, env: Env): FileChild[] {
  const { theme } = env;
  const width = block.header.length;
  const total = block.widths?.reduce((sum, w) => sum + w, 0) ?? 0;
  const textTwips = convertMillimetersToTwip(env.textWidthMm);
  const columnWidths = Array.from({ length: width }, (_, col) =>
    Math.round(textTwips * (total > 0 && block.widths ? block.widths[col]! / total : 1 / width)),
  );
  // Hairline of the design system: the text color at ~18% over the background.
  const border = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: hex(mixHex(theme.colors.background, theme.colors.text, 0.18)),
  };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (runs: Run[], col: number, kind: 'header' | 'body' | 'footer') =>
    new TableCell({
      width: { size: columnWidths[col]!, type: WidthType.DXA },
      borders,
      ...(kind === 'header'
        ? { shading: { type: ShadingType.CLEAR, fill: hex(theme.colors.surface), color: 'auto' } }
        : kind === 'footer'
          ? { shading: { type: ShadingType.CLEAR, fill: hex(theme.colors.surface), color: 'auto' } }
          : {}),
      children: [
        new Paragraph({
          alignment: ALIGN[block.align?.[col] ?? 'left'],
          children: runChildren(
            runs,
            env,
            kind === 'header'
              ? { bold: true, color: hex(theme.colors.text) }
              : kind === 'footer'
                ? { bold: true }
                : undefined,
          ),
        }),
      ],
    });
  const rows = [
    new TableRow({ tableHeader: true, children: block.header.map((runs, col) => cell(runs, col, 'header')) }),
    ...block.rows.map(
      (row) => new TableRow({ cantSplit: true, children: row.map((runs, col) => cell(runs, col, 'body')) }),
    ),
    ...(block.footer
      ? [
          new TableRow({
            cantSplit: true,
            children: block.footer.map((runs, col) => cell(runs, col, 'footer')),
          }),
        ]
      : []),
  ];
  const out: FileChild[] = [
    new Table({ rows, columnWidths, width: { size: textTwips, type: WidthType.DXA } }),
  ];
  if (block.caption) {
    out.push(
      new Paragraph({
        style: 'Caption',
        children: [
          new TextRun({ text: block.caption, italics: true, color: hex(theme.colors.muted), size: 18 }),
        ],
      }),
    );
  } else {
    out.push(new Paragraph({ children: [], spacing: { after: 120 } }));
  }
  return out;
}

function calloutBlock(block: CalloutBlock, env: Env): FileChild[] {
  warnOnce(
    env,
    'callout',
    'Callouts were exported as shaded single-cell tables (Word has no callout element).',
  );
  const color = env.theme.colors[block.tone];
  const none = { style: BorderStyle.NONE, size: 0, color: 'auto' };
  const children: Paragraph[] = [];
  if (block.title)
    children.push(
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: block.title, bold: true, color: hex(color) })],
      }),
    );
  children.push(new Paragraph({ children: runChildren(block.runs, env) }));
  return [
    new Table({
      width: { size: convertMillimetersToTwip(env.textWidthMm), type: WidthType.DXA },
      columnWidths: [convertMillimetersToTwip(env.textWidthMm)],
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              shading: { type: ShadingType.CLEAR, fill: tint(color, 0.12), color: 'auto' },
              borders: {
                top: none,
                bottom: none,
                right: none,
                left: { style: BorderStyle.SINGLE, size: 24, color: hex(color) },
              },
              margins: { top: 100, bottom: 100, left: 160, right: 160 },
              children,
            }),
          ],
        }),
      ],
    }),
    new Paragraph({ children: [], spacing: { after: 120 } }),
  ];
}

function imageBlock(block: ImageBlock, env: Env): FileChild[] {
  const asset = env.images.get(block.asset);
  const type = asset ? DOCX_IMAGE_TYPES[asset.mimeType] : undefined;
  const size = asset && type ? imageSize(asset.bytes) : undefined;
  const out: FileChild[] = [];
  if (asset && type && size && size.width > 0 && size.height > 0) {
    const maxWidth = env.textWidthMm * PX_PER_MM * (block.width ?? 1);
    const scale = Math.min(1, maxWidth / size.width);
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        keepNext: Boolean(block.caption),
        children: [
          new ImageRun({
            type,
            data: asset.bytes,
            transformation: {
              width: Math.round(size.width * scale),
              height: Math.round(size.height * scale),
            },
            altText: { name: block.asset.slice('asset://'.length), title: block.alt, description: block.alt },
          }),
        ],
      }),
    );
  } else {
    if (asset)
      warnOnce(
        env,
        `image:${block.asset}`,
        `Image ${block.asset} (${asset.mimeType}) is not supported by Word; its alt text was used.`,
      );
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: `[${block.alt}]`, italics: true, color: hex(env.theme.colors.muted) }),
        ],
      }),
    );
  }
  if (block.caption) {
    out.push(
      new Paragraph({
        style: 'Caption',
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: block.caption, italics: true, color: hex(env.theme.colors.muted), size: 18 }),
        ],
      }),
    );
  }
  return out;
}

function blockChildren(block: Block, env: Env): FileChild[] {
  const { theme } = env;
  switch (block.type) {
    case 'heading':
      return [
        new Paragraph({
          heading: HEADINGS[block.level - 1]!,
          children: [
            new Bookmark({ id: env.bookmarks.get(block.id)!, children: runChildren(block.runs, env) }),
          ],
        }),
      ];
    case 'paragraph':
      return [
        new Paragraph({
          alignment: ALIGN[block.align ?? 'left'],
          children: [
            new Bookmark({ id: env.bookmarks.get(block.id)!, children: runChildren(block.runs, env) }),
          ],
        }),
      ];
    case 'list':
      return listParagraphs(block, env);
    case 'table':
      return tableBlock(block, env);
    case 'callout':
      return calloutBlock(block, env);
    case 'quote': {
      const out: FileChild[] = [
        new Paragraph({
          style: 'Quote',
          indent: { left: 567 },
          border: {
            left: { style: BorderStyle.SINGLE, size: 18, color: hex(theme.colors.muted), space: 12 },
          },
          children: runChildren(block.runs, env, { italics: true, color: hex(theme.colors.muted) }),
        }),
      ];
      if (block.attribution) {
        out.push(
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: `— ${block.attribution}`, color: hex(theme.colors.muted) })],
          }),
        );
      }
      return out;
    }
    case 'code': {
      const lines = block.text.split('\n');
      return lines.map(
        (line, index) =>
          new Paragraph({
            spacing: { before: 0, after: index === lines.length - 1 ? 160 : 0, line: 260 },
            keepLines: true,
            keepNext: index < lines.length - 1,
            shading: { type: ShadingType.CLEAR, fill: hex(theme.colors.surface), color: 'auto' },
            children: [new TextRun({ text: line || ' ', font: theme.fonts.mono, size: 18 })],
          }),
      );
    }
    case 'image':
      return imageBlock(block, env);
    case 'divider':
      return [
        new Paragraph({
          children: [],
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: tint(theme.colors.muted, 0.5), space: 1 },
          },
        }),
      ];
    case 'pageBreak':
      return [new Paragraph({ children: [new PageBreak()] })];
    case 'toc': {
      const pt = env.ctx.locale.toLowerCase().startsWith('pt');
      const title = block.title ?? (pt ? 'Sumário' : 'Contents');
      return [
        new Paragraph({
          children: [new TextRun({ text: title, bold: true, size: 28, color: hex(theme.colors.text) })],
          spacing: { after: 120 },
        }),
        new TableOfContents(title, {
          hyperlink: true,
          headingStyleRange: `1-${block.maxLevel ?? DEFAULT_TOC_LEVEL}`,
        }),
      ];
    }
  }
}

function coverChildren(content: DocumentContent, env: Env): FileChild[] {
  const cover = content.cover;
  if (!cover) return [];
  const { theme } = env;
  const out: FileChild[] = [new Paragraph({ children: [], spacing: { before: 2400 } })];
  if (cover.eyebrow) {
    out.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: cover.eyebrow.toUpperCase(),
            bold: true,
            color: hex(theme.colors.accent),
            size: 20,
          }),
        ],
      }),
    );
  }
  out.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      // Brand rule under the title (the screen cover uses the brand gradient, which Word cannot edit).
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 18, color: hex(themeBrand(theme).primaryDeep), space: 8 },
      },
      children: [new TextRun({ text: cover.title })],
    }),
  );
  if (cover.subtitle) {
    out.push(
      new Paragraph({
        spacing: { after: 480 },
        children: [new TextRun({ text: cover.subtitle, color: hex(theme.colors.muted), size: 28 })],
      }),
    );
  }
  if (cover.fields?.length) {
    const none = { style: BorderStyle.NONE, size: 0, color: 'auto' };
    const borders = { top: none, bottom: none, left: none, right: none };
    const textTwips = convertMillimetersToTwip(env.textWidthMm);
    out.push(
      new Table({
        width: { size: textTwips, type: WidthType.DXA },
        borders: TableBorders.NONE,
        columnWidths: [Math.round(textTwips * 0.3), Math.round(textTwips * 0.7)],
        rows: cover.fields.map(
          (field) =>
            new TableRow({
              children: [
                new TableCell({
                  borders,
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({ text: field.label, bold: true, color: hex(theme.colors.muted) }),
                      ],
                    }),
                  ],
                }),
                new TableCell({
                  borders,
                  children: [new Paragraph({ children: [new TextRun({ text: field.value })] })],
                }),
              ],
            }),
        ),
      }),
    );
  }
  out.push(new Paragraph({ children: [new PageBreak()] }));
  return out;
}

/** Block ids used as internal link targets (`#id`). */
function linkTargets(content: DocumentContent): Set<string> {
  const out = new Set<string>();
  const visit = (runs: readonly Run[]) => {
    for (const run of runs) if (run.link?.startsWith('#')) out.add(run.link.slice(1));
  };
  const items = (list: readonly ListItem[]) => {
    for (const item of list) {
      visit(item.runs);
      if (item.children) items(item.children);
    }
  };
  for (const block of content.blocks) {
    if ('runs' in block) visit(block.runs);
    if (block.type === 'list') items(block.items);
    if (block.type === 'table')
      for (const row of [block.header, ...block.rows, ...(block.footer ? [block.footer] : [])])
        row.forEach(visit);
  }
  return out;
}

/** Builds the Word document (exposed for tests and custom packaging). */
export async function buildDocx(content: DocumentContent, ctx: ExportContext): Promise<Document> {
  const theme = ctx.theme;
  const geometry = pageGeometry(content.page);
  const env: Env = {
    ctx,
    theme,
    content,
    bookmarks: bookmarkNames(content.blocks),
    images: await resolveImages(content, ctx),
    textWidthMm: geometry.width - geometry.margins.left - geometry.margins.right,
    numbering: [],
    warned: new Set(),
  };
  const children: FileChild[] = [...coverChildren(content, env)];
  const linked = linkTargets(content);
  for (const block of content.blocks) {
    ctx.signal?.throwIfAborted();
    // Headings and paragraphs carry their own bookmark; other link targets get a 1pt bookmark line.
    if (linked.has(block.id) && block.type !== 'heading' && block.type !== 'paragraph') {
      children.push(
        new Paragraph({
          spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
          keepNext: true,
          children: [new Bookmark({ id: env.bookmarks.get(block.id)!, children: [] })],
        }),
      );
    }
    children.push(...blockChildren(block, env));
  }
  const page = content.page;
  const portrait = PAGE_SIZES_MM[page?.size ?? 'A4'];
  const muted = hex(theme.colors.muted);
  const headers = page?.header
    ? {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: page.header, color: muted, size: 18 })],
            }),
          ],
        }),
      }
    : undefined;
  const footerParagraphs: Paragraph[] = [];
  if (page?.footer)
    footerParagraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: page.footer, color: muted, size: 18 })],
      }),
    );
  if (page?.pageNumbers) {
    footerParagraphs.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES],
            color: muted,
            size: 18,
          }),
        ],
      }),
    );
  }
  const heading = (size: number, color: string) => ({
    run: { font: theme.fonts.heading, size, bold: true, color: hex(color) },
    paragraph: { spacing: { before: 320, after: 120 }, keepNext: true, keepLines: true },
  });
  return new Document({
    title: ctx.title,
    creator: 'artkit',
    features: { updateFields: content.blocks.some((block) => block.type === 'toc') },
    styles: {
      default: {
        document: {
          run: { font: theme.fonts.body, size: 21, color: hex(theme.colors.text) },
          paragraph: { spacing: { after: 120, line: 276 } },
        },
        title: {
          run: { font: theme.fonts.heading, size: 56, bold: true, color: hex(theme.colors.text) },
          paragraph: { spacing: { after: 160 } },
        },
        heading1: heading(36, theme.colors.text),
        heading2: heading(30, theme.colors.text),
        heading3: heading(26, theme.colors.accent),
        heading4: heading(23, theme.colors.text),
      },
      paragraphStyles: [
        {
          id: 'Caption',
          name: 'Caption',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { italics: true, size: 18, color: muted },
          paragraph: { spacing: { before: 60, after: 200 } },
        },
        {
          id: 'Quote',
          name: 'Quote',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { italics: true, color: muted },
        },
      ],
    },
    numbering: { config: env.numbering },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(portrait.width),
              height: convertMillimetersToTwip(portrait.height),
              orientation:
                page?.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: {
              top: convertMillimetersToTwip(geometry.margins.top),
              right: convertMillimetersToTwip(geometry.margins.right),
              bottom: convertMillimetersToTwip(geometry.margins.bottom),
              left: convertMillimetersToTwip(geometry.margins.left),
            },
          },
          ...(content.cover && (headers || footerParagraphs.length) ? { titlePage: true } : {}),
        },
        ...(headers
          ? { headers: { ...headers, ...(content.cover ? { first: new Header({ children: [] }) } : {}) } }
          : {}),
        ...(footerParagraphs.length
          ? {
              footers: {
                default: new Footer({ children: footerParagraphs }),
                ...(content.cover ? { first: new Footer({ children: [] }) } : {}),
              },
            }
          : {}),
        children,
      },
    ],
  });
}

/**
 * Word export: native heading styles (Word's TOC works), list numbering, tables with a repeated header row,
 * callouts as shaded single-cell tables (reported as a warning), cover followed by a page break, header and
 * footer with page numbers, images from the asset store and the toc as a Word TOC field.
 */
export const documentDocxExporter: ArtifactExporter<DocumentContent> = {
  kind: 'document',
  format: 'docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  extension: 'docx',
  runtime: 'any',
  async export(content, ctx) {
    const doc = await buildDocx(content, ctx);
    return new Uint8Array(await Packer.toArrayBuffer(doc));
  },
};
