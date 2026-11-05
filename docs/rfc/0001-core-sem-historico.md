# RFC 0001: núcleo sem histórico, arquivamento nem aprovação

- **Status:** aceita em 2026-11-05. `docs/spec.md` está na versão 0.4 com estas seções atualizadas.
- **Data:** 2026-11-05.
- **Alcance:** contrato de dados (§25 do spec) e API dos pacotes `core`, `node`, `agent`, `ai-sdk`, `mcp`, `react`.

## Contexto

A biblioteca precisa acompanhar qualquer harness de IA. Histórico, arquivamento e aprovação são políticas de cada
aplicação, não do núcleo: o harness sabe o que significa "salvar", quem aprova e por quanto tempo guardar versões.
Manter essas políticas no núcleo impõe um modelo de publicação que nem todo harness usa.

## Decisão

1. **Módulos da biblioteca:** visualização de artefato, editor de artefato e exportação de artefato. Nada além disso.
2. **Removidos do núcleo:**
   - histórico de versões e restauração (`history`, `restore`, `VersionEntry`, snapshots, `restoredFrom`);
   - arquivamento (`archive`, status `archived`);
   - aprovação e publicação (`submit`, `approve`, `reject`, `publish`, status `draft`, `pending_approval` e `published`,
     `publishedVersion`, `ApprovalPolicy`, `APPROVAL_REQUIRED`, ferramenta `artifact_submit`);
   - rebase do `baseVersion` e idempotência de `apply` e `create`, que dependiam do histórico.
3. **Mantidos:** `version` como contador de concorrência, `baseVersion` estrito (qualquer base diferente da versão atual
   responde `VERSION_CONFLICT` com `details.currentVersion`), locks, exportação e ferramentas de leitura e edição.
4. **Salvar é ação do harness:** o editor mantém um rascunho local (`DraftSession`) com desfazer e refazer locais. O botão
   Salvar (e Ctrl/Cmd+S) emite `onSave({ artifactId, format, baseVersion, title, locale, themeId, content, operations })`.
   A biblioteca não persiste versões; o harness decide o que o salvamento faz e devolve o artefato salvo.
5. **Visual:** claro e escuro seguem os tokens do design system Mouts (fio de 1px na cor do texto, divisórias a 40%,
   botão primário em pill, anel de foco de 2px, sem sombra).

## Consequências

- Uma edição computada sobre uma base antiga é sempre recusada. O cliente relê o artefato e refaz o lote. Não há mais
  rebase automático de edições que tocam áreas diferentes.
- O store guarda apenas o artefato atual. Não há como reabrir uma versão anterior pela biblioteca.
- Criação repetida (mesma chave de idempotência) cria outro artefato. A deduplicação, se necessária, é do harness.
- O painel perde a aba de histórico, o seletor de versões e a revisão de aprovação. A exportação passa a exportar o
  artefato atual salvo na biblioteca, não o rascunho do editor.

## Seções do spec afetadas (versão 0.3)

| Seção                          | Mudança                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| §1 e §2 (visão, pacotes)       | Remover "versões, aprovação" da descrição do núcleo e das linhas de `@artkit/core`, `react`, `ai-sdk`. |
| §7.1 (envelope)                | Remover o campo `status`; `meta.publishedVersion` sai.                                                 |
| §9.1 (pipeline)                | Remover o passo de gravação no histórico.                                                              |
| §9.2 (concorrência)            | Trocar rebase por `VERSION_CONFLICT` para qualquer base diferente.                                     |
| §9.4 (histórico e restauração) | Seção removida.                                                                                        |
| §9.5 (erros)                   | Remover `APPROVAL_REQUIRED`.                                                                           |
| §11 e §14 (editor e edição)    | O editor aplica lotes localmente; nada é enviado durante a edição; o salvamento é `onSave`.            |
| §13 (componentes)              | Painel sem histórico, aprovação, diff de versões e seletor de versões; cartão sem status.              |
| §15.1 (toolkit)                | Remover `artifact_submit`; `artifact_list` sem filtro de status; leitura e exportação sem `version`.   |
| §15.3 (cliente)                | Remover `history`, `restore`, `setStatus`; `apply` sem `idempotencyKey` e `message`.                   |
| §15.4 (caminho de uma edição)  | Remover envio após a prévia; o lote vai ao harness no salvamento.                                      |
| §17.1 (contratos do store)     | Remover `history`, `setStatus`, `findByIdempotencyKey`; `commit` sem `status`, `operations` e `diff`.  |
| §17.2 (ciclo de vida)          | Seção removida.                                                                                        |
| §17.3 (eventos)                | Remover `artifact.status_changed`; `artifact.committed` sem `rebased`.                                 |
| §26 e §27 (fases e mudanças)   | Registrar a 0.4 como remoção do histórico, arquivamento e aprovação.                                   |

## Riscos

- O projeto Workia é o consumidor-alvo e pode depender de versões e aprovação. Antes de aceitar, confirmar se ela
  mantém essas políticas no próprio harness. A adaptação do Workia continua fora deste repositório.
- Sem rebase, colaboração simultânea entre agente e usuário fica mais barulhenta: o usuário pode precisar refazer
  edições. Mitigação: o rascunho do editor fica intacto quando chega uma versão nova, e o erro indica a versão atual.
- Auditoria e reversão passam a depender do harness. Se a aplicação precisar disso, ela persiste as versões no
  `onSave`.

## Implementação já feita neste repositório

O núcleo, `node`, `agent`, `ai-sdk`, `mcp` e `react` já seguem esta RFC, com testes passando. Os exemplos
(`examples/playground`) usam `onSave` como harness: cada salvamento vira uma nova versão. `docs/spec.md` ainda descreve o
modelo anterior até esta RFC ser aceita.
