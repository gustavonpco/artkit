import type { LintIssue } from '@artkit-ai/core';
import { roundTripDiverges } from './dialect.js';
import { parseDocument, sectionText, subtreeEnd } from './document.js';

const LONG_SECTION_CHARS = 4000;

/** Lint (spec §10.6): heading structure, accessibility of images, internal links and empty or very long sections. */
export function lintMarkdown(content: string): LintIssue[] {
  const document = parseDocument(content);
  const sections = document.sections;
  const issues: LintIssue[] = [];
  const anchors = new Set(sections.map((section) => section.anchor));
  let previousLevel = 0;
  sections.forEach((section, index) => {
    const target = `section:${section.anchor}`;
    if (previousLevel > 0 && section.level > previousLevel + 1) {
      issues.push({
        code: 'heading-jump',
        severity: 'warning',
        target,
        message: `O título "${section.title}" pula do nível ${previousLevel} para o ${section.level}.`,
        hint: 'Use o próximo nível de título ou suba um nível.',
      });
    }
    previousLevel = section.level;
    const body = section.body.join('\n');
    if (/!\[\s*\]\(/.test(body)) {
      issues.push({
        code: 'image-alt',
        severity: 'warning',
        target,
        message: `Há imagem sem texto alternativo na seção "${section.title}".`,
        hint: 'Escreva o texto alternativo entre colchetes.',
      });
    }
    for (const match of body.matchAll(/\]\(#([^)\s]+)\)/g)) {
      if (!anchors.has(match[1]!)) {
        issues.push({
          code: 'broken-anchor',
          severity: 'warning',
          target,
          message: `O link "#${match[1]}" não aponta para nenhuma seção.`,
          hint: 'Use uma âncora listada no outline.',
        });
      }
    }
    const end = subtreeEnd(sections, index);
    const hasChildren = end - index > 1;
    if (!hasChildren && body.trim() === '') {
      issues.push({
        code: 'empty-section',
        severity: 'info',
        target,
        message: `A seção "${section.title}" está vazia.`,
      });
    }
    if (!hasChildren && sectionText(sections, index).length > LONG_SECTION_CHARS) {
      issues.push({
        code: 'long-section',
        severity: 'info',
        target,
        message: `A seção "${section.title}" tem mais de ${LONG_SECTION_CHARS} caracteres sem subtítulos.`,
        hint: 'Divida a seção em subtítulos.',
      });
    }
  });
  if (content.trim() !== '' && roundTripDiverges(content)) {
    issues.push({
      code: 'roundtrip',
      severity: 'info',
      target: 'document',
      message: 'O editor serializaria este Markdown de forma diferente (ex.: ênfase com _ vira *).',
      hint: 'Isso não altera o conteúdo; use a forma que o editor produz para evitar diferenças.',
    });
  }
  return issues;
}
