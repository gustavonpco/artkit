import { ellipsis, type LintContext, type LintIssue } from '@artkit-ai/core';
import { blockText, runsText } from './runs.js';
import type { Block, DocumentContent, ListItem, Run } from './schema.js';
import { DEFAULT_TOC_LEVEL, tocEntries } from './toc.js';

const GENERIC_ALT =
  /^(image|img|picture|photo|foto|imagem|figura|figure|screenshot|captura|logo|icon|ícone|grafico|gráfico|chart)?\s*\d*$/i;
const FILE_NAME = /\.(png|jpe?g|gif|webp|svg)$/i;

/** True when the alt text says nothing about the image (empty, generic word, file name or asset id). */
export function isMeaninglessAlt(alt: string, asset: string): boolean {
  const text = alt.trim();
  return (
    text.length < 3 ||
    GENERIC_ALT.test(text) ||
    FILE_NAME.test(text) ||
    text === asset.slice('asset://'.length)
  );
}

function allRuns(block: Block): Run[][] {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
    case 'callout':
    case 'quote':
      return [block.runs];
    case 'list': {
      const out: Run[][] = [];
      const walk = (items: ListItem[]) => {
        for (const item of items) {
          out.push(item.runs);
          if (item.children) walk(item.children);
        }
      };
      walk(block.items);
      return out;
    }
    case 'table':
      return [...block.header, ...block.rows.flat(), ...(block.footer ?? [])];
    default:
      return [];
  }
}

/** Non-blocking quality rules (spec §10.2). */
export function lintDocument(content: DocumentContent, ctx: LintContext): LintIssue[] {
  const isPt = ctx.locale.toLowerCase().startsWith('pt');
  const say = (ptText: string, enText: string) => (isPt ? ptText : enText);
  const issues: LintIssue[] = [];
  const ids = new Set(content.blocks.map((block) => block.id));
  let previousLevel: number | undefined;

  for (const block of content.blocks) {
    const target = `block:${block.id}`;
    switch (block.type) {
      case 'heading': {
        if (previousLevel !== undefined && block.level > previousLevel + 1) {
          issues.push({
            code: 'heading_level_skip',
            severity: 'warning',
            target,
            message: say(
              `O título pula do nível ${previousLevel} para o ${block.level}.`,
              `Heading jumps from level ${previousLevel} to ${block.level}.`,
            ),
            hint: say(`Use o nível ${previousLevel + 1}.`, `Use level ${previousLevel + 1}.`),
          });
        }
        previousLevel = block.level;
        if (!runsText(block.runs).trim()) {
          issues.push({
            code: 'empty_heading',
            severity: 'warning',
            target,
            message: say('Título vazio.', 'Empty heading.'),
            hint: say('Escreva o título ou remova o bloco.', 'Write the heading or remove the block.'),
          });
        }
        break;
      }
      case 'paragraph':
        if (!runsText(block.runs).trim()) {
          issues.push({
            code: 'empty_paragraph',
            severity: 'warning',
            target,
            message: say('Parágrafo vazio.', 'Empty paragraph.'),
            hint: say('Remova o bloco ou escreva o texto.', 'Remove the block or write the text.'),
          });
        }
        break;
      case 'image':
        if (isMeaninglessAlt(block.alt, block.asset)) {
          issues.push({
            code: 'image_alt',
            severity: 'warning',
            target,
            message: say(
              `A imagem não tem texto alternativo significativo ("${block.alt}").`,
              `The image has no meaningful alternative text ("${block.alt}").`,
            ),
            hint: say('Descreva o que a imagem mostra em "alt".', 'Describe what the image shows in "alt".'),
          });
        }
        break;
      case 'table': {
        if (block.header.every((cell) => !runsText(cell).trim())) {
          issues.push({
            code: 'table_without_header',
            severity: 'warning',
            target,
            message: say('A tabela não tem cabeçalho.', 'The table has no header.'),
            hint: say('Dê um nome a cada coluna em "header".', 'Name every column in "header".'),
          });
        }
        if (block.rows.length === 0) {
          issues.push({
            code: 'empty_table',
            severity: 'info',
            target,
            message: say('A tabela não tem linhas.', 'The table has no rows.'),
          });
        }
        break;
      }
      case 'list': {
        const empty = allRuns(block).filter((runs) => !runsText(runs).trim()).length;
        if (empty > 0) {
          issues.push({
            code: 'empty_list_item',
            severity: 'warning',
            target,
            message: say(`A lista tem ${empty} item(ns) vazio(s).`, `The list has ${empty} empty item(s).`),
          });
        }
        break;
      }
      case 'callout':
      case 'quote':
        if (!runsText(block.runs).trim()) {
          issues.push({
            code: `empty_${block.type}`,
            severity: 'warning',
            target,
            message: say('Bloco sem texto.', 'Block without text.'),
          });
        }
        break;
      case 'code':
        if (!block.text.trim())
          issues.push({
            code: 'empty_code',
            severity: 'info',
            target,
            message: say('Bloco de código vazio.', 'Empty code block.'),
          });
        break;
      case 'toc':
        if (tocEntries(content.blocks, block.maxLevel ?? DEFAULT_TOC_LEVEL).length === 0) {
          issues.push({
            code: 'toc_without_headings',
            severity: 'warning',
            target,
            message: say(
              'O sumário não tem títulos para listar.',
              'The table of contents has no headings to list.',
            ),
            hint: say('Adicione títulos ou aumente maxLevel.', 'Add headings or raise maxLevel.'),
          });
        }
        break;
      default:
        break;
    }
    for (const runs of allRuns(block)) {
      for (const run of runs) {
        if (run.link?.startsWith('#') && !ids.has(run.link.slice(1))) {
          issues.push({
            code: 'broken_anchor',
            severity: 'warning',
            target,
            message: say(
              `O link "${run.link}" aponta para um bloco que não existe.`,
              `Link "${run.link}" points to a block that does not exist.`,
            ),
            hint: say('Use "#<id do bloco>".', 'Use "#<block id>".'),
          });
        }
      }
    }
  }

  const last = content.blocks[content.blocks.length - 1];
  if (last?.type === 'pageBreak') {
    issues.push({
      code: 'trailing_page_break',
      severity: 'info',
      target: `block:${last.id}`,
      message: say(
        'Quebra de página no fim gera uma página em branco.',
        'A page break at the end creates a blank page.',
      ),
    });
  }
  for (let i = 1; i < content.blocks.length; i++) {
    const a = content.blocks[i - 1]!;
    const b = content.blocks[i]!;
    if (a.type === 'heading' && b.type === 'heading' && b.level <= a.level) {
      issues.push({
        code: 'empty_section',
        severity: 'info',
        target: `block:${a.id}`,
        message: say(
          `A seção "${ellipsis(blockText(a), 40)}" está vazia.`,
          `Section "${ellipsis(blockText(a), 40)}" is empty.`,
        ),
      });
    }
  }
  return issues;
}
