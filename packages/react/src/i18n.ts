/** UI strings in pt-BR and en (spec §18.1). Templates use `{name}` placeholders. */
export const uiMessages = {
  en: {
    loading: 'Loading…',
    generating: 'Generating…',
    provisional: 'Preview — not saved yet',
    noRenderer: 'No renderer is registered for kind "{format}". Showing the raw content.',
    loadFailed: 'Could not load this artifact.',
    retry: 'Retry',
    close: 'Close',
    open: 'Open',
    openTitle: 'Open {title}',
    version: 'Version',
    versionShort: 'v{version}',
    latest: 'latest',
    tabView: 'View',
    tabCode: 'Code',
    tabEdit: 'Edit',
    save: 'Save',
    tabsLabel: 'Artifact sections',
    copy: 'Copy',
    copied: 'Copied',
    export: 'Export',
    exportAs: 'Export as {format}',
    exporting: 'Exporting…',
    exported: 'Exported {filename}',
    exportWarnings: 'Export finished with warnings:',
    noExportFormats: 'No export formats available',
    rejectReason: 'Reason for rejection',
    confirmReject: 'Confirm rejection',
    cancel: 'Cancel',
    loadMore: 'Load more',
    by: 'by {actor}',
    actor_agent: 'agent',
    actor_user: 'user',
    actor_system: 'system',
    changes: 'Changes',
    noChanges: 'No changes.',
    change_added: 'Added',
    change_removed: 'Removed',
    change_changed: 'Changed',
    change_moved: 'Moved',
    diffUnified: 'Highlighted',
    diffSplit: 'Side by side',
    diffViewLabel: 'Diff layout',
    lineAdded: 'added',
    lineRemoved: 'removed',
    undo: 'Undo',
    redo: 'Redo',
    undone: 'Change undone',
    redone: 'Change redone',
    saving: 'Saving…',
    saved: 'Saved',
    unsaved: 'Unsaved changes',
    rolledBack: 'Change rejected: {message}',
    dismiss: 'Dismiss',
    readOnly: 'Read only',
    lockedBy: 'Locked by the {actor} — editing is disabled.',
    lockedUntil: 'Locked until {time} — editing is disabled.',
    reapplyMine: 'Reapply my edit',
    editorLabel: 'Editor for {title}',
    lintWarnings: '{count} lint warnings',
  },
  'pt-BR': {
    loading: 'Carregando…',
    generating: 'Gerando…',
    provisional: 'Prévia — ainda não salva',
    noRenderer: 'Não há renderer registrado para o tipo "{format}". Exibindo o conteúdo bruto.',
    loadFailed: 'Não foi possível carregar este artefato.',
    retry: 'Tentar novamente',
    close: 'Fechar',
    open: 'Abrir',
    openTitle: 'Abrir {title}',
    version: 'Versão',
    versionShort: 'v{version}',
    latest: 'atual',
    tabView: 'Visualização',
    tabCode: 'Código',
    tabEdit: 'Editar',
    save: 'Salvar',
    tabsLabel: 'Seções do artefato',
    copy: 'Copiar',
    copied: 'Copiado',
    export: 'Exportar',
    exportAs: 'Exportar como {format}',
    exporting: 'Exportando…',
    exported: '{filename} exportado',
    exportWarnings: 'Exportação concluída com avisos:',
    noExportFormats: 'Nenhum formato de exportação disponível',
    rejectReason: 'Motivo da rejeição',
    confirmReject: 'Confirmar rejeição',
    cancel: 'Cancelar',
    loadMore: 'Carregar mais',
    by: 'por {actor}',
    actor_agent: 'agente',
    actor_user: 'usuário',
    actor_system: 'sistema',
    changes: 'Alterações',
    noChanges: 'Nenhuma alteração.',
    change_added: 'Inserido',
    change_removed: 'Removido',
    change_changed: 'Alterado',
    change_moved: 'Movido',
    diffUnified: 'Destacado',
    diffSplit: 'Lado a lado',
    diffViewLabel: 'Layout do diff',
    lineAdded: 'inserida',
    lineRemoved: 'removida',
    undo: 'Desfazer',
    redo: 'Refazer',
    undone: 'Alteração desfeita',
    redone: 'Alteração refeita',
    saving: 'Salvando…',
    saved: 'Salvo',
    unsaved: 'Alterações não salvas',
    rolledBack: 'Alteração rejeitada: {message}',
    dismiss: 'Dispensar',
    readOnly: 'Somente leitura',
    lockedBy: 'Bloqueado pelo {actor} — edição desativada.',
    lockedUntil: 'Bloqueado até {time} — edição desativada.',
    reapplyMine: 'Reaplicar minha edição',
    editorLabel: 'Editor de {title}',
    lintWarnings: '{count} avisos de lint',
  },
} satisfies Record<string, Record<string, string>>;

export type UiMessageKey = keyof (typeof uiMessages)['en'];
export type UiMessages = Record<UiMessageKey, string>;

/** Extra or overriding catalogs, keyed by BCP-47 tag (`es`, `pt-PT`) or language. */
export type UiMessageOverrides = Record<string, Partial<UiMessages>>;

export type Translate = (key: UiMessageKey, params?: Record<string, string | number>) => string;

function format(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * Resolution order: exact override, language override, built-in catalog (pt* → pt-BR, else en), English.
 */
export function createTranslator(locale: string, overrides: UiMessageOverrides = {}): Translate {
  const language = locale.split('-')[0]?.toLowerCase() ?? '';
  const builtIn: UiMessages = language === 'pt' ? uiMessages['pt-BR'] : uiMessages.en;
  const layers = [overrides[locale], overrides[language], builtIn, uiMessages.en];
  return (key, params) => {
    for (const layer of layers) {
      const template = layer?.[key];
      if (template !== undefined) return format(template, params);
    }
    return key;
  };
}
