import type { ArtifactExporter, ExportContext } from '@artkit-ai/core';
import { parseFrontMatter, splitFrontMatter } from '@artkit-ai/format-markdown';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];
const PAGE_BREAK = /^\s*<!--\s*pagebreak\s*-->\s*$/;
const ALERT = /^>\s*\[!(NOTE|WARNING|TIP)\]\s*$/;
const TABLE_ROW = /^\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** Inline emphasis only: **bold**, *italic* and `code` become runs; everything else stays as plain text. */
export function runsOf(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > last) runs.push(new TextRun(text.slice(last, match.index)));
    const token = match[0];
    if (token.startsWith('**')) runs.push(new TextRun({ text: token.slice(2, -2), bold: true }));
    else if (token.startsWith('`')) runs.push(new TextRun({ text: token.slice(1, -1), font: 'Courier New' }));
    else runs.push(new TextRun({ text: token.slice(1, -1), italics: true }));
    last = match.index! + token.length;
  }
  if (last < text.length) runs.push(new TextRun(text.slice(last)));
  return runs.length > 0 ? runs : [new TextRun('')];
}

function tableOf(rows: string[]): Table {
  const cells = rows.map((row) =>
    row
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim()),
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: cells.map(
      (cellsOfRow, index) =>
        new TableRow({
          tableHeader: index === 0,
          children: cellsOfRow.map(
            (text) => new TableCell({ children: [new Paragraph({ children: runsOf(text) })] }),
          ),
        }),
    ),
  });
}

/** Converts the Markdown body into docx blocks. Images are not embedded here; they are reported as warnings. */
export function markdownBlocks(body: string, warn: (message: string) => void): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let inFence = false;
  const flush = () => {
    if (paragraph.length > 0)
      blocks.push(new Paragraph({ children: runsOf(paragraph.join(' ')), spacing: { after: 160 } }));
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^ {0,3}(`{3,}|~{3,})/.test(line)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      blocks.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Courier New' })] }));
      continue;
    }
    if (PAGE_BREAK.test(line)) {
      flush();
      blocks.push(new Paragraph({ children: [new PageBreak()] }));
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)(?:\s+\{#[A-Za-z0-9_-]+\})?\s*$/.exec(line);
    if (heading) {
      flush();
      blocks.push(
        new Paragraph({ heading: HEADINGS[heading[1]!.length - 1], children: runsOf(heading[2]!) }),
      );
      continue;
    }
    if (ALERT.test(line)) {
      flush();
      const kind = ALERT.exec(line)![1]!;
      const quoted: string[] = [];
      while (i + 1 < lines.length && lines[i + 1]!.startsWith('>'))
        quoted.push(lines[++i]!.replace(/^>\s?/, ''));
      blocks.push(
        new Paragraph({
          shading: {
            type: ShadingType.CLEAR,
            fill: kind === 'WARNING' ? 'FDECEA' : kind === 'TIP' ? 'E8F5E9' : 'E3F2FD',
            color: 'auto',
          },
          children: [new TextRun({ text: `${kind}: `, bold: true }), ...runsOf(quoted.join(' '))],
        }),
      );
      continue;
    }
    if (TABLE_ROW.test(line) && TABLE_SEPARATOR.test(lines[i + 1] ?? '')) {
      flush();
      const rows = [line];
      i += 1;
      while (i + 1 < lines.length && TABLE_ROW.test(lines[i + 1]!)) rows.push(lines[++i]!);
      blocks.push(tableOf(rows));
      continue;
    }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      flush();
      blocks.push(new Paragraph({ children: runsOf(bullet[1]!), bullet: { level: 0 } }));
      continue;
    }
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (numbered) {
      flush();
      blocks.push(
        new Paragraph({
          children: runsOf(numbered[1]!),
          numbering: { reference: 'artkit-numbers', level: 0 },
        }),
      );
      continue;
    }
    if (/!\[[^\]]*\]\(/.test(line))
      warn('Imagens não são incorporadas no docx nesta versão; o texto alternativo foi mantido.');
    if (line.trim() === '') flush();
    else paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

/** docx exporter for Markdown documents: title from the artifact, frontmatter as a cover line, then the body. */
export const markdownDocxExporter: ArtifactExporter<string> = {
  format: 'markdown',
  target: 'docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  extension: 'docx',
  runtime: 'any',
  async export(content: string, ctx: ExportContext): Promise<Uint8Array> {
    const { block, body } = splitFrontMatter(content);
    const meta = parseFrontMatter(block);
    const cover = [
      new Paragraph({
        heading: HeadingLevel.TITLE,
        children: [new TextRun(ctx.title)],
        alignment: AlignmentType.LEFT,
      }),
      ...meta.map(
        (entry) =>
          new Paragraph({
            children: [new TextRun({ text: `${entry.key}: `, bold: true }), new TextRun(entry.value)],
          }),
      ),
    ];
    const document = new Document({
      creator: 'artkit',
      title: ctx.title,
      numbering: {
        config: [
          {
            reference: 'artkit-numbers',
            levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT }],
          },
        ],
      },
      sections: [{ children: [...cover, ...markdownBlocks(body, ctx.warn)] }],
    });
    return new Uint8Array(await Packer.toBuffer(document));
  },
};
