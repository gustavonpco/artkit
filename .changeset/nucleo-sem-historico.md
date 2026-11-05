---

"@artkit-ai/agent": minor
"@artkit-ai/ai-sdk": minor
"@artkit-ai/core": minor
"@artkit-ai/evals": minor
"@artkit-ai/export-docx": minor
"@artkit-ai/export-pptx": minor
"@artkit-ai/export-xlsx": minor
"@artkit-ai/format-markdown": minor
"@artkit-ai/format-openui": minor
"@artkit-ai/format-sheet": minor
"@artkit-ai/mcp": minor
"@artkit-ai/node": minor
"@artkit-ai/openui-components": minor
"@artkit-ai/react": minor
"@artkit-ai/skills": minor
---

Núcleo sem histórico, arquivamento nem aprovação (RFC 0001). A biblioteca cobre visualização, edição e exportação; salvar é uma ação do editor (`onSave`) que o harness decide o que significa. Saíram `history`, `restore`, `submit`, `approve`, `publish`, `archive`, o campo `status`, `artifact_submit`, `idempotencyKey` e o rebase do `baseVersion`, que agora precisa ser a versão atual. Novos formatos Markdown (Tiptap), planilha (Univer) e OpenUI, com editor e barra completos e temas claro e escuro do design system Mouts.
