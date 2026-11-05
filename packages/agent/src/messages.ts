import { catalogLocale } from '@artkit-ai/core';

type Template = (params: Record<string, string>) => string;

// Toolkit-specific model-facing messages. Error codes still come from the core catalog (spec §10.3).
const messages = {
  'pt-BR': {
    INVALID_ARGUMENTS: (p) => `Argumentos inválidos para ${p.tool}.`,
    FORMAT_MISMATCH: (p) =>
      `O artefato ${p.id} está no formato "${p.actual}", mas esta ferramenta aplica operações de "${p.expected}".`,
    FORMAT_MISMATCH_HINT: (p) => `Use a ferramenta ${p.tool}.`,
    GUIDE_TOPIC_HINT: (p) => `Tópicos disponíveis: ${p.topics}.`,
    MISSING_SCOPE: () => 'A ferramenta foi chamada sem escopo de workspace e ator.',
    EXPORT_UNAVAILABLE: () => 'Exportação indisponível: nenhum armazenamento de assets foi configurado.',
    UNKNOWN_TOOL: (p) => `Ferramenta desconhecida: ${p.tool}.`,
  },
  en: {
    INVALID_ARGUMENTS: (p) => `Invalid arguments for ${p.tool}.`,
    FORMAT_MISMATCH: (p) =>
      `Artifact ${p.id} is in the "${p.actual}" format, but this tool applies "${p.expected}" operations.`,
    FORMAT_MISMATCH_HINT: (p) => `Use the ${p.tool} tool.`,
    GUIDE_TOPIC_HINT: (p) => `Available topics: ${p.topics}.`,
    MISSING_SCOPE: () => 'The tool was called without a workspace and actor scope.',
    EXPORT_UNAVAILABLE: () => 'Export is unavailable: no asset store was configured.',
    UNKNOWN_TOOL: (p) => `Unknown tool: ${p.tool}.`,
  },
} satisfies Record<'pt-BR' | 'en', Record<string, Template>>;

export type AgentMessageKey = keyof (typeof messages)['en'];

export function msg(
  locale: string | undefined,
  key: AgentMessageKey,
  params: Record<string, string> = {},
): string {
  return messages[catalogLocale(locale)][key](params);
}
