# @artkit-ai/agent

## 0.2.0

### Minor Changes

- dd000c9: Núcleo sem histórico, arquivamento nem aprovação (RFC 0001). A biblioteca cobre visualização, edição e exportação; salvar é uma ação do editor (`onSave`) que o harness decide o que significa. Saíram `history`, `restore`, `submit`, `approve`, `publish`, `archive`, o campo `status`, `artifact_submit`, `idempotencyKey` e o rebase do `baseVersion`, que agora precisa ser a versão atual. Novos formatos Markdown (Tiptap), planilha (Univer) e OpenUI, com editor e barra completos e temas claro e escuro do design system Mouts.

### Patch Changes

- Updated dependencies [dd000c9]
  - @artkit-ai/core@0.2.0
