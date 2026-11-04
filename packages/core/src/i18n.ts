export type SupportedLocale = 'pt-BR' | 'en';

/** Picks the message catalog language for a BCP-47 tag. Anything that is not Portuguese falls back to English. */
export function catalogLocale(locale: string | undefined): SupportedLocale {
  return locale?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

type Template = (params: Record<string, unknown>) => string;

const messages = {
  'pt-BR': {
    UNKNOWN_KIND: (p) => `O tipo "${p.kind}" não está registrado.`,
    UNKNOWN_KIND_HINT: (p) => `Use um dos tipos disponíveis: ${p.available}.`,
    DUPLICATE_KIND: (p) => `O tipo "${p.kind}" já está registrado.`,
    NOT_FOUND: (p) => `${p.what} não encontrado: ${p.id}.`,
    NOT_FOUND_HINT: () => 'Confira o id com artifact_list ou leia o artefato novamente.',
    INVALID_ENVELOPE: () => 'O envelope do artefato é inválido.',
    UNSUPPORTED_VERSION: (p) =>
      `O conteúdo usa a versão de esquema ${p.found}, mas o tipo "${p.kind}" suporta até a versão ${p.supported}.`,
    MIGRATION_FAILED: (p) => `Falha ao migrar o conteúdo da versão ${p.from} para a ${p.to}.`,
    INVALID_CONTENT: () => 'O conteúdo é inválido.',
    INVALID_OPERATION: (p) => `A operação ${p.index} é inválida.`,
    INVALID_OPERATIONS: () => 'O lote de operações é inválido.',
    OPERATION_FAILED: (p) => `A operação ${p.index} não pôde ser aplicada.`,
    VERSION_CONFLICT: (p) =>
      `O artefato mudou desde a versão ${p.baseVersion} (versão atual: ${p.currentVersion}) e o lote toca itens alterados.`,
    VERSION_CONFLICT_HINT: () => 'Leia o artefato novamente e refaça as operações a partir da versão atual.',
    LOCKED: (p) => `O artefato está bloqueado por ${p.holder} até ${p.expiresAt}.`,
    LOCKED_HINT: () => 'Aguarde a liberação ou peça ao usuário para liberar o bloqueio.',
    LIMIT_EXCEEDED: (p) => `Limite "${p.limit}" excedido: máximo ${p.max}, encontrado ${p.found}.`,
    LIMIT_EXCEEDED_HINT: () => 'Divida o conteúdo em mais artefatos ou reduza a quantidade de itens.',
    PERMISSION_DENIED: (p) => `Ação "${p.action}" negada.`,
    APPROVAL_REQUIRED: (p) => `A ação "${p.action}" depende de aprovação humana.`,
    APPROVAL_REQUIRED_HINT: () => 'Use artifact_submit para enviar o artefato para aprovação.',
    ASSET_REJECTED: (p) => `Asset rejeitado: ${p.reason}.`,
    EXPORT_FAILED: (p) => `Falha ao exportar para ${p.format}.`,
    INTERNAL_ERROR: () => 'Erro interno ao processar a solicitação.',
    INVALID_STATUS_TRANSITION: (p) => `Não é possível mudar o status de "${p.from}" para "${p.to}".`,
    INPUT_FORMAT_UNSUPPORTED: (p) => `O tipo "${p.kind}" não aceita a entrada "${p.format}".`,
    INPUT_FORMAT_HINT: (p) => `Formatos aceitos: ${p.available}.`,
    EXPORTER_NOT_FOUND: (p) => `Não há exportador de "${p.kind}" para o formato "${p.format}".`,
    THEME_NOT_FOUND: (p) => `Tema "${p.themeId}" não registrado.`,
    DUPLICATE_ID: (p) => `O id "${p.id}" está repetido.`,
    DUPLICATE_ID_HINT: () => 'Cada item precisa de um id único dentro do artefato.',
    ZOD_INVALID_TYPE: (p) => `Esperado ${p.expected}.`,
    ZOD_INVALID_TYPE_HINT: (p) => `Informe um valor do tipo ${p.expected}.`,
    ZOD_UNRECOGNIZED_KEYS: (p) => `Campos não reconhecidos: ${p.keys}.`,
    ZOD_UNRECOGNIZED_KEYS_HINT: () => 'Remova os campos que não fazem parte do esquema.',
    ZOD_INVALID_VALUE: (_p) => `Valor inválido.`,
    ZOD_INVALID_VALUE_HINT: (p) => `Use um dos valores: ${p.values}.`,
    ZOD_TOO_BIG: (p) => `Valor acima do máximo (${p.maximum}).`,
    ZOD_TOO_BIG_HINT: (p) => `Use no máximo ${p.maximum}.`,
    ZOD_TOO_SMALL: (p) => `Valor abaixo do mínimo (${p.minimum}).`,
    ZOD_TOO_SMALL_HINT: (p) => `Use no mínimo ${p.minimum}.`,
    ZOD_INVALID_FORMAT: (p) => `Formato inválido${p.detail ? `: ${p.detail}` : ''}.`,
    ZOD_INVALID_FORMAT_HINT: () => 'Ajuste o valor para o formato esperado pelo esquema.',
    ZOD_INVALID_UNION: () => 'O valor não corresponde a nenhuma das formas aceitas.',
    ZOD_INVALID_UNION_HINT: (p) =>
      p.options
        ? `Use um dos valores de "${p.discriminator}": ${p.options}.`
        : 'Confira o campo discriminador e os campos obrigatórios.',
    ZOD_CUSTOM: (p) => String(p.message ?? 'Valor inválido.'),
  },
  en: {
    UNKNOWN_KIND: (p) => `Kind "${p.kind}" is not registered.`,
    UNKNOWN_KIND_HINT: (p) => `Use one of the available kinds: ${p.available}.`,
    DUPLICATE_KIND: (p) => `Kind "${p.kind}" is already registered.`,
    NOT_FOUND: (p) => `${p.what} not found: ${p.id}.`,
    NOT_FOUND_HINT: () => 'Check the id with artifact_list or read the artifact again.',
    INVALID_ENVELOPE: () => 'The artifact envelope is invalid.',
    UNSUPPORTED_VERSION: (p) =>
      `Content uses schema version ${p.found}, but kind "${p.kind}" supports up to version ${p.supported}.`,
    MIGRATION_FAILED: (p) => `Failed to migrate content from version ${p.from} to ${p.to}.`,
    INVALID_CONTENT: () => 'The content is invalid.',
    INVALID_OPERATION: (p) => `Operation ${p.index} is invalid.`,
    INVALID_OPERATIONS: () => 'The operation batch is invalid.',
    OPERATION_FAILED: (p) => `Operation ${p.index} could not be applied.`,
    VERSION_CONFLICT: (p) =>
      `The artifact changed since version ${p.baseVersion} (current version: ${p.currentVersion}) and the batch touches changed items.`,
    VERSION_CONFLICT_HINT: () => 'Read the artifact again and redo the operations from the current version.',
    LOCKED: (p) => `The artifact is locked by ${p.holder} until ${p.expiresAt}.`,
    LOCKED_HINT: () => 'Wait for the lock to expire or ask the user to release it.',
    LIMIT_EXCEEDED: (p) => `Limit "${p.limit}" exceeded: max ${p.max}, found ${p.found}.`,
    LIMIT_EXCEEDED_HINT: () => 'Split the content into more artifacts or reduce the number of items.',
    PERMISSION_DENIED: (p) => `Action "${p.action}" denied.`,
    APPROVAL_REQUIRED: (p) => `Action "${p.action}" requires human approval.`,
    APPROVAL_REQUIRED_HINT: () => 'Use artifact_submit to send the artifact for approval.',
    ASSET_REJECTED: (p) => `Asset rejected: ${p.reason}.`,
    EXPORT_FAILED: (p) => `Failed to export to ${p.format}.`,
    INTERNAL_ERROR: () => 'Internal error while processing the request.',
    INVALID_STATUS_TRANSITION: (p) => `Cannot change status from "${p.from}" to "${p.to}".`,
    INPUT_FORMAT_UNSUPPORTED: (p) => `Kind "${p.kind}" does not accept "${p.format}" input.`,
    INPUT_FORMAT_HINT: (p) => `Accepted formats: ${p.available}.`,
    EXPORTER_NOT_FOUND: (p) => `No "${p.kind}" exporter for format "${p.format}".`,
    THEME_NOT_FOUND: (p) => `Theme "${p.themeId}" is not registered.`,
    DUPLICATE_ID: (p) => `Id "${p.id}" is duplicated.`,
    DUPLICATE_ID_HINT: () => 'Every item needs an id that is unique inside the artifact.',
    ZOD_INVALID_TYPE: (p) => `Expected ${p.expected}.`,
    ZOD_INVALID_TYPE_HINT: (p) => `Provide a value of type ${p.expected}.`,
    ZOD_UNRECOGNIZED_KEYS: (p) => `Unrecognized fields: ${p.keys}.`,
    ZOD_UNRECOGNIZED_KEYS_HINT: () => 'Remove fields that are not part of the schema.',
    ZOD_INVALID_VALUE: () => 'Invalid value.',
    ZOD_INVALID_VALUE_HINT: (p) => `Use one of: ${p.values}.`,
    ZOD_TOO_BIG: (p) => `Value above the maximum (${p.maximum}).`,
    ZOD_TOO_BIG_HINT: (p) => `Use at most ${p.maximum}.`,
    ZOD_TOO_SMALL: (p) => `Value below the minimum (${p.minimum}).`,
    ZOD_TOO_SMALL_HINT: (p) => `Use at least ${p.minimum}.`,
    ZOD_INVALID_FORMAT: (p) => `Invalid format${p.detail ? `: ${p.detail}` : ''}.`,
    ZOD_INVALID_FORMAT_HINT: () => 'Adjust the value to the format expected by the schema.',
    ZOD_INVALID_UNION: () => 'The value does not match any accepted shape.',
    ZOD_INVALID_UNION_HINT: (p) =>
      p.options
        ? `Use one of the "${p.discriminator}" values: ${p.options}.`
        : 'Check the discriminator field and the required fields.',
    ZOD_CUSTOM: (p) => String(p.message ?? 'Invalid value.'),
  },
} satisfies Record<SupportedLocale, Record<string, Template>>;

export type MessageKey = keyof (typeof messages)['en'];

/** Formats a catalog message. Custom catalogs can be merged with {@link extendMessages}. */
export function t(locale: string | undefined, key: MessageKey, params: Record<string, unknown> = {}): string {
  const catalog = messages[catalogLocale(locale)] as Record<string, Template>;
  const template = extra[catalogLocale(locale)]?.[key] ?? catalog[key];
  return template ? template(params) : key;
}

const extra: Partial<Record<SupportedLocale, Record<string, Template>>> = {};

/** Overrides or adds catalog messages for a locale (spec §18.1: extensible catalog). */
export function extendMessages(
  locale: SupportedLocale,
  overrides: Partial<Record<MessageKey, Template>>,
): void {
  extra[locale] = { ...(extra[locale] ?? {}), ...(overrides as Record<string, Template>) };
}
