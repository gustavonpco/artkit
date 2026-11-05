# artkit: especificação da biblioteca de artefatos para agentes de IA

| Campo | Valor |
|---|---|
| Documento | Plano e especificação de desenvolvimento |
| Versão | 0.4 (rascunho para validação; RFC 0001 aceita) |
| Data | 05/11/2026 |
| Nome do projeto | `artkit` (nome provisório, sujeito a verificação no npm e no INPI) |
| Licença pretendida | Apache-2.0 para o núcleo aberto, com módulos comerciais separados |
| Integração de referência | Vercel AI SDK 7 (APIs de agente), com camada agnóstica de harness e servidor MCP |
| Racional central | Cada artefato é salvo no formato nativo da ferramenta que o edita ou renderiza |

---

## 1. Visão geral

O `artkit` é uma biblioteca open source para React e Node que permite a agentes de IA criar, ler, editar e exportar artefatos. A biblioteca é o núcleo (visualização, edição e exportação); histórico, arquivamento e aprovação são decisões do harness (RFC 0001). A biblioteca não define formatos próprios de conteúdo: cada artefato é salvo no formato nativo da ferramenta que o edita ou renderiza, e o `artkit` atua como camada de orquestração sobre esses formatos.

São três famílias de artefato:

- **Documento:** Markdown (GFM com frontmatter), editado pelo usuário no Tiptap.
- **Planilha:** formato interno do Univer (`IWorkbookData`), editado pelo usuário no Univer.
- **Visuais:** OpenUI Lang, renderizado pelo runtime do OpenUI com uma biblioteca de componentes do `artkit`. Cobre slides, dashboards, relatórios, protótipos, fluxogramas e diagramas. Visuais são editados apenas pelo agente.

O valor da biblioteca está no que é transversal a todos os formatos: um contrato único de adaptador, edição incremental validada, leitura compacta para o modelo, diff, exportação, integração com harnesses e skills que ensinam o agente a usar cada formato.

## 2. Objetivos e não objetivos

### 2.1 Objetivos

- Oferecer um núcleo pequeno, sem dependência de React, Node ou do AI SDK, com envelope, versão de concorrência, diff, operações e contrato de adaptador.
- Entregar três adaptadores de formato nativo: Markdown, Univer e OpenUI Lang.
- Entregar uma biblioteca de componentes OpenUI para slides (Deck e Slide), dashboards, relatórios, protótipos e diagramas.
- Entregar edição visual para documento (Tiptap) e planilha (Univer), gerando as mesmas operações usadas pelo agente.
- Exportar documento para docx, pdf, md e html; planilha para xlsx, csv e pdf; visuais para pdf, png e html, e slides para pptx editável.
- Integrar com o AI SDK 7 de forma nativa, com qualquer harness via MCP e com harnesses que aceitam ferramentas próprias.
- Publicar skills que ensinam agentes a usar cada formato e a integrar a biblioteca.
- Medir a facilidade de uso por agentes com evals por formato e por modelo, usados como critério de saída de cada release.

### 2.2 Não objetivos

- Definir um padrão de dados próprio para documentos, planilhas ou visuais.
- Edição visual de artefatos OpenUI pelo usuário. A edição é feita pelo agente.
- Recursos da versão Pro do Univer (colaboração, importação e exportação, impressão, tabelas dinâmicas, gráficos). A exportação xlsx é feita por exportador próprio.
- Motor de fórmulas próprio. O recálculo usa o motor do Univer.
- Colaboração simultânea em tempo real na versão 1. Entra como módulo comercial.
- Importação fiel de arquivos Office na versão 1.
- Execução de HTML ou JavaScript arbitrário gerado pelo modelo.

## 3. Princípios de design

- **Formato nativo como fonte da verdade.** O conteúdo salvo é exatamente o que o editor ou o renderer consome. Não há conversão entre um modelo interno e o formato da ferramenta.
- **Adaptador por formato.** Todo conhecimento sobre um formato fica no seu adaptador: validação, leitura compacta, operações, diff, lint, exportação e instruções.
- **O agente não manipula formatos verbosos diretamente.** Ele lê pela leitura compacta e escreve por operações. Isso vale principalmente para o `IWorkbookData`.
- **Edição incremental e verificável.** Toda alteração é um lote de operações validado, aplicado de forma atômica e versionado. Falha em uma operação descarta o lote.
- **Erros escritos para o modelo corrigir.** Toda rejeição traz código, localização exata e dica de correção.
- **Agnóstico de harness.** Apenas a camada de integração conhece o AI SDK ou o MCP. Do núcleo para baixo nada importa harness, React ou APIs de Node.
- **Dependências mínimas e permissivas.** Cada dependência precisa de justificativa técnica e licença compatível com Apache-2.0. Versões de formatos de terceiros são fixadas.
- **Segurança por padrão.** Apenas componentes registrados no OpenUI, nenhum HTML bruto, validação estrita de entrada e menor privilégio no armazenamento.
- **Responsabilidade única por módulo.** Núcleo, adaptadores, componentes, renderers, editores, exportadores e integrações ficam em pacotes ou módulos separados.

## 4. Decisões de arquitetura registradas

| Decisão | Escolha | Motivo |
|---|---|---|
| Formato de cada artefato | Nativo da ferramenta | Menos conversões, alinhamento com ecossistemas que os modelos já conhecem |
| Editor de documento | Tiptap (núcleo MIT) com `@tiptap/markdown` | Editor open source mais adotado da família ProseMirror, com Markdown bidirecional oficial |
| Editor de planilha | Univer, apenas núcleo aberto (Apache-2.0) | Experiência mais próxima do Excel entre as opções abertas, roda no navegador e no servidor |
| Formato salvo da planilha | `IWorkbookData` do Univer | Decisão 1B |
| Visuais | OpenUI Lang com biblioteca de componentes do `artkit` | Linguagem compacta, preparada para streaming e restrita a componentes registrados |
| Slides | Componentes Deck e Slide com exportador pptx nativo | Decisão 2B: propostas em PowerPoint editável |
| Edição de visuais | Apenas pelo agente | Decisão 3A |
| Recálculo de fórmulas | Motor do Univer, executado no servidor | Elimina motor de fórmulas próprio |
| Exportação xlsx | Exportador próprio com ExcelJS | Evita a versão Pro do Univer |

## 5. Glossário

| Termo | Definição |
|---|---|
| Artefato | Unidade persistida e versionada de conteúdo. |
| Formato | Linguagem ou estrutura nativa em que o conteúdo é salvo (`markdown`, `univer-sheet`, `openui`). |
| Versão do formato | Versão fixada do formato de terceiros com que o conteúdo foi gravado (por exemplo, `univer-sheet@0.x`). |
| Envelope | Registro com metadados de sistema que envolve o conteúdo. |
| Adaptador | Módulo que implementa o contrato da seção 8 para um formato. |
| Operação | Alteração tipada e atômica definida pelo adaptador. |
| Lote | Lista de operações aplicadas juntas, gerando uma nova versão. |
| Leitura compacta | Representação textual do artefato otimizada para o modelo. |
| Lint | Verificação não bloqueante de qualidade. |
| Diff | Resumo das mudanças entre duas versões. |
| Componente OpenUI | Componente React registrado na biblioteca do `artkit` e disponível para o modelo na OpenUI Lang. |
| Declaração | Linha nomeada da OpenUI Lang (`kpi1 = StatCard(...)`). |
| Toolkit | Conjunto de ferramentas de agente gerado a partir dos adaptadores registrados. |
| Skill | Pasta de instruções no formato Agent Skills, carregada pelo agente sob demanda. |

## 6. Arquitetura

### 6.1 Camadas

```
┌──────────────────────────────────────────────────────────────────┐
│ Aplicação React: chat (useChat + useArtifacts) e painel          │
│ de artefatos (Tiptap, Univer, renderer OpenUI)                   │
├──────────────────────────────────────────────────────────────────┤
│ Harness do agente: ToolLoopAgent (AI SDK 7), HarnessAgent        │
│ (Pi, OpenCode), clientes MCP                                     │
├──────────────────────────────────────────────────────────────────┤
│ Integração artkit: @artkit/ai-sdk | @artkit/mcp | @artkit/skills │
├──────────────────────────────────────────────────────────────────┤
│ Núcleo: @artkit/agent (toolkit) | @artkit/core (envelope,        │
│ versão, diff, operações, erros)                                  │
├──────────────────────────────────────────────────────────────────┤
│ Adaptadores: @artkit/format-markdown | @artkit/format-sheet |    │
│ @artkit/format-openui (+ @artkit/openui-components)              │
├──────────────────────────────────────────────────────────────────┤
│ Serviços Node: @artkit/node (store, assets, exportação, render   │
│ headless, pool headless do Univer)                               │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 Pacotes

| Pacote | Responsabilidade |
|---|---|
| `@artkit/core` | Envelope, contrato de adaptador, registro, pipeline de operações, versão de concorrência, diff, catálogo de erros, contratos de store, assets e eventos. |
| `@artkit/format-markdown` | Adaptador Markdown: dialeto, validação, leitura por seções, operações, diff, lint e instruções. |
| `@artkit/format-sheet` | Adaptador Univer: validação do `IWorkbookData`, leitura em grade A1, operações sobre o Univer headless, diff, lint e instruções. |
| `@artkit/format-openui` | Adaptador OpenUI Lang: parser, validação contra a biblioteca de componentes, leitura por declarações, operações, diff, lint e instruções. |
| `@artkit/openui-components` | Biblioteca de componentes OpenUI do `artkit` (layout, dados, relatório, protótipo, Deck e Slide, Diagram) com esquemas de propriedades. |
| `@artkit/react` | Provider, visualização, editor com rascunho local e ação de salvar, exportação, cartão de chat, hooks e prévia em streaming. |
| `@artkit/node` | Stores de referência, store de assets, orquestração de exportação, render headless e pool de instâncias do Univer headless. |
| `@artkit/export-docx`, `export-xlsx`, `export-pptx` | Exportadores binários isolados, para que o consumidor instale apenas o que usa. |
| `@artkit/agent` | Toolkit neutro, instruções, formatação de erros para o modelo e orçamento de tokens. |
| `@artkit/ai-sdk` | Adaptador para o AI SDK 7: ferramentas, contexto, data parts e hook `useArtifacts`. |
| `@artkit/mcp` | Servidor MCP com as mesmas ferramentas, recursos de leitura e prompts. |
| `@artkit/skills` | Skills `artkit-artefatos` e `artkit-integracao`, geradas a partir dos adaptadores e dos componentes. |
| `@artkit/evals` | Suíte de avaliação por formato e por modelo. |

Cada pacote de formato publica subcaminhos para que o consumidor carregue apenas o necessário: `.` (adaptador, roda em navegador, Node e edge quando o formato permitir), `/react` (visualizador ou editor) e, quando houver, `/server` (partes que dependem de Node, como o Univer headless).

### 6.3 Regras de dependência

- `@artkit/core` depende apenas de `zod`.
- Adaptadores dependem do núcleo e das bibliotecas do seu formato, nunca de outros adaptadores.
- `@artkit/agent` não conhece AI SDK nem MCP. `@artkit/ai-sdk` tem `ai` como peer dependency; `@artkit/react` tem `react` como peer dependency.
- Render headless usa Playwright como peer dependency opcional de `@artkit/node`.
- Nenhum pacote lê variáveis de ambiente. Toda configuração entra por parâmetro e é validada na criação do objeto.
- Dependências circulares são bloqueadas no CI, assim como dependências com licença fora da lista permitida.

### 6.4 Dependências externas

| Dependência | Uso | Licença | Observação |
|---|---|---|---|
| `zod` 4 | Esquemas, validação, JSON Schema das ferramentas | MIT | Única dependência do núcleo. |
| `@tiptap/core`, extensões gratuitas e `@tiptap/markdown` | Editor de documento e parser e serializador de Markdown | MIT | Sem extensões Pro. A extensão de Markdown está em beta. |
| Univer (pacotes do núcleo aberto) | Editor de planilha, modelo `IWorkbookData`, motor de fórmulas, execução headless | Apache-2.0 | Sem pacotes `@univerjs-pro`. Versão fixada. |
| `@openuidev/react-lang` | Parser, `defineComponent`, `createLibrary` e `Renderer` do OpenUI | MIT | Versão fixada. |
| `exceljs` | Exportação xlsx | MIT | Validada na POC. |
| `docx` | Exportação docx | MIT | Validada na POC. |
| `pptxgenjs` | Exportação pptx | MIT | Validada na POC. |
| Biblioteca de gráficos (a decidir) | Componentes de gráfico OpenUI | MIT | Pode ser a biblioteca de gráficos padrão do OpenUI. |
| Mermaid ou renderer próprio (a decidir) | Componente Diagram | MIT | Ver decisões em aberto. |
| `@modelcontextprotocol/sdk` | Servidor MCP | MIT | |
| `playwright` | Render headless para pdf e png | Apache-2.0 | Peer opcional. |

Ficam vetadas: pacotes `@univerjs-pro`, extensões Tiptap Pro, HyperFormula (GPLv3 ou comercial), BlockNote XL (GPL) e tldraw (chave de licença em produção).

### 6.5 Ambiente suportado

- TypeScript estrito, distribuído como ESM com tipos.
- Node 22 ou superior; navegadores modernos (duas últimas versões de Chrome, Edge, Firefox e Safari); React 19.
- Runtimes edge suportados para `core`, `agent`, `ai-sdk` e os adaptadores Markdown e OpenUI. O adaptador de planilha exige Node para a execução headless.

## 7. Envelope e versionamento

### 7.1 Envelope

```json
{
  "id": "art_01JBX7Q2N4ZK8T3M6W5R9YH2DC",
  "format": "markdown",
  "formatVersion": "gfm@1",
  "version": 7,
  "title": "Proposta técnica: Portal de Fornecedores",
  "locale": "pt-BR",
  "themeId": "default",
  "content": "---\ncliente: Grupo Meridiano\n---\n# Proposta técnica\n...",
  "meta": {
    "createdAt": "2026-11-05T11:00:00Z",
    "updatedAt": "2026-11-05T11:32:10Z",
    "createdBy": { "type": "agent", "id": "agente-propostas" },
    "updatedBy": { "type": "user", "id": "usr_123" },
    "tags": ["proposta"]
  }
}
```

| Campo | Regra |
|---|---|
| `id` | Gerado pelo store, prefixo `art_` seguido de ULID. |
| `format` | `markdown`, `univer-sheet` ou `openui`. Deve existir no registro. |
| `formatVersion` | Versão do formato ou da biblioteca de terceiros com que o conteúdo foi gravado. |
| `version` | Inteiro monotônico que conta os lotes aplicados ao conteúdo atual. É o token de concorrência de `baseVersion`; a biblioteca não guarda versões anteriores. |
| `title` | 1 a 200 caracteres. |
| `locale` | Tag BCP-47 para formatação de números, datas e moeda. |
| `themeId` | Tema registrado, aplicado ao Tiptap, ao Univer e aos componentes OpenUI. |
| `content` | Texto (Markdown e OpenUI Lang) ou objeto (`IWorkbookData`), validado pelo adaptador. |
| `meta` | Preenchido pelo store. Nunca escrito pelo agente. |

### 7.2 Versões do formato e migrações

- Cada adaptador declara as versões de formato que lê e a versão que grava.
- Ao atualizar uma dependência de formato (Univer, OpenUI, Tiptap), o adaptador publica uma migração de `formatVersion` antiga para a nova, executada na leitura e persistida no próximo commit.
- Conteúdo com versão de formato não suportada é rejeitado com `UNSUPPORTED_FORMAT_VERSION`.
- O semver dos pacotes é independente das versões de formato. Uma versão maior de pacote só remove a leitura de uma versão de formato após ciclo de depreciação.

### 7.3 Tema

Um tema único (cores, tipografia, paleta de gráficos) é aplicado aos três formatos: variáveis CSS no Tiptap e nos componentes OpenUI, estilos padrão no Univer e mapeamento para os exportadores. Pacotes de identidade visual prontos fazem parte da oferta comercial.

### 7.4 Assets

Imagens e anexos ficam no `AssetStore` e são referenciados por `asset://<id>` no Markdown e nas propriedades dos componentes OpenUI. O store valida tipo MIME (png, jpeg, webp, gif, svg sanitizado) e tamanho. URLs externas só são aceitas para domínios permitidos pela aplicação.

### 7.5 Limites iniciais

Valores configuráveis por registro:

| Item | Limite inicial |
|---|---|
| Envelope serializado | 5 MB |
| Documento | 200.000 caracteres |
| Planilha | 20 abas; 50.000 células preenchidas |
| Visual OpenUI | 2.000 declarações; 100 slides por Deck |
| Operações por lote | 200 |

## 8. Contrato do adaptador

```ts
interface FormatAdapter<Content, Operation> {
  format: string;                       // 'markdown'
  formatVersion: string;                // versão gravada
  readableVersions: string[];           // versões aceitas na leitura
  label: string;

  validate(content: unknown, ctx: AdapterContext): ValidationResult<Content>;
  operationSchema: z.ZodType<Operation>;
  apply(content: Content, ops: Operation[], ctx: AdapterContext): Promise<ApplyResult<Content>>;

  read(content: Content, request: ReadRequest): ReadResult;   // leitura compacta
  diff(before: Content, after: Content): ChangeSummary[];
  lint(content: Content): LintIssue[];
  parsePartial(raw: string): Content | undefined;             // prévia em streaming

  migrations: FormatMigration[];
  limits: FormatLimits;
  instructions: FormatInstructions;                           // base das skills
}

interface ApplyResult<Content> {
  content: Content;
  createdRefs: string[];                // âncoras, declarações ou intervalos criados
  warnings: LintIssue[];
}
```

- `apply` é assíncrono porque o adaptador de planilha executa as operações numa instância headless do Univer.
- `apply` não lê relógio nem aleatoriedade, para permitir replay, auditoria e testes de propriedade. Fórmulas voláteis (`TODAY`, `NOW`, `RAND`) são recalculadas apenas na leitura e na exportação.
- Exportadores são registrados à parte por formato, para manter o adaptador livre de dependências pesadas.

## 9. Protocolo de operações

### 9.1 Pipeline

1. Validar o pedido (formato, limites, autorização do ator sobre o artefato).
2. Carregar o artefato e migrar o formato se necessário.
3. Conferir `baseVersion` (seção 9.2).
4. Validar cada operação com o `operationSchema` do adaptador. Erro em qualquer uma rejeita o lote, informando o índice.
5. Aplicar o lote pelo adaptador sobre uma cópia do conteúdo.
6. Validar o conteúdo resultante inteiro e os limites.
7. Calcular diff e lint.
8. Persistir com controle otimista de versão: a base precisa ser a versão atual.
9. Emitir `artifact.committed` e devolver nova versão, referências criadas, diff e avisos.

Falha entre os passos 3 e 8 descarta a cópia. O artefato nunca fica parcialmente alterado.

### 9.2 Concorrência

- `baseVersion` é obrigatória em `apply`.
- `baseVersion` precisa ser a versão atual do artefato. Qualquer outra base responde `VERSION_CONFLICT` com `details.currentVersion`; o cliente relê o artefato e refaz o lote. Não há rebase automático: a biblioteca não guarda versões anteriores para comparar.
- Edições do usuário no Tiptap e no Univer são aplicadas ao rascunho local pelo mesmo motor; o salvamento entrega os lotes ao harness (seção 14.3).
- Bloqueio opcional com expiração impede edição humana enquanto o agente gera um artefato grande.

### 9.3 Operações comuns a todos os formatos

| Operação | Efeito |
|---|---|
| `set_title` | Altera o título. |
| `set_theme` | Troca o tema. |
| `set_locale` | Troca o locale. |
| `replace_content` | Substitui o conteúdo inteiro. Permitida, mas desencorajada nas skills para artefatos grandes. |

### 9.4 Versões

A biblioteca mantém apenas o conteúdo atual e o contador `version`. Não há histórico, restauração, snapshots nem arquivamento (RFC 0001). Salvar versões é decisão do harness, que recebe a ação de salvar do editor (seção 14.3).

### 9.5 Catálogo de erros

Formato único devolvido ao modelo:

```json
{
  "ok": false,
  "error": {
    "code": "OPERATION_FAILED",
    "message": "A operação 1 não pôde ser aplicada.",
    "issues": [
      {
        "location": "operations[1].find",
        "message": "O trecho '16 semanas' aparece 3 vezes na seção 'cronograma'.",
        "hint": "Inclua mais contexto no trecho para torná-lo único."
      }
    ]
  }
}
```

| Código | Situação |
|---|---|
| `UNKNOWN_FORMAT` | Formato não registrado. |
| `UNSUPPORTED_FORMAT_VERSION` | Versão de formato não suportada. |
| `MIGRATION_FAILED` | Falha ao migrar conteúdo antigo. |
| `NOT_FOUND` | Artefato, versão, seção, declaração, aba ou asset inexistente. |
| `INVALID_CONTENT` | Conteúdo inválido para o formato. |
| `INVALID_OPERATION` | Operação viola o esquema. |
| `OPERATION_FAILED` | Operação válida que não pode ser aplicada ao estado atual. |
| `VERSION_CONFLICT` | `baseVersion` diferente da versão atual. `details.currentVersion` informa a versão atual. |
| `LOCKED` | Artefato bloqueado por outro autor. |
| `LIMIT_EXCEEDED` | Limite excedido. |
| `PERMISSION_DENIED` | Ação negada pelo hook de autorização. |
| `ASSET_REJECTED` | Asset com tipo, tamanho ou origem não permitidos. |
| `EXPORT_FAILED` | Falha no exportador. |
| `ENGINE_UNAVAILABLE` | Instância headless do Univer indisponível ou excedeu o tempo limite. |

Mensagens para o modelo não incluem stack trace, caminhos de servidor ou dados de outros artefatos. A aplicação recebe o erro original em `ArtifactError` com `cause`.

## 10. Adaptador de documento (Markdown)

### 10.1 Dialeto

- CommonMark com extensões GFM: tabelas, listas de tarefas, tachado e links automáticos.
- Frontmatter YAML para metadados do documento (cliente, data, versão, campos de capa).
- Alertas no estilo GitHub (`> [!NOTE]`, `> [!WARNING]`, `> [!TIP]`) para callouts.
- Imagens por `asset://<id>` com texto alternativo obrigatório.
- Quebra de página explícita por diretiva própria (`<!-- pagebreak -->`), usada apenas pelos exportadores.
- HTML embutido não é permitido. É removido na validação.
- Limitação conhecida: célula de tabela aceita um único parágrafo, como no Markdown padrão.

O dialeto é implementado pelo mesmo conjunto de extensões Tiptap no editor e no servidor, por meio do `MarkdownManager` do `@tiptap/markdown`, garantindo que o que o agente grava é o que o editor carrega.

### 10.2 Validação

- Parse completo pelo `MarkdownManager` com as extensões do dialeto.
- Invariante de ida e volta: parse seguido de serialização deve produzir texto equivalente. Divergência é registrada como aviso e coberta por testes.
- Frontmatter validado como YAML e, opcionalmente, contra um esquema fornecido pela aplicação.

### 10.3 Âncoras

- Cada título gera uma âncora estável derivada do texto (`escopo`, `cronograma-de-entrega`), com sufixo numérico em caso de repetição.
- O agente pode fixar uma âncora explícita com `{#id}` ao final do título; âncoras explícitas não mudam quando o título é renomeado.
- Seções são delimitadas pelos títulos: uma seção vai de um título até o próximo título de nível igual ou superior.

### 10.4 Leitura compacta

| Modo | Conteúdo |
|---|---|
| `outline` | Árvore de títulos com âncora, nível e tamanho em caracteres de cada seção, mais o frontmatter. |
| `section` | Markdown de uma ou mais seções por âncora. |
| `full` | Markdown completo, respeitando o orçamento de tokens, com cursor para continuação. |

### 10.5 Operações

| Operação | Efeito |
|---|---|
| `replace_text` | Substitui um trecho único dentro de uma seção (`section`, `find`, `replace`). Falha se o trecho não for único. |
| `replace_section` | Substitui o corpo de uma seção, mantendo o título. |
| `insert_section` | Insere uma seção nova após outra, com título e corpo. |
| `remove_section` | Remove uma seção e suas subseções. |
| `move_section` | Move uma seção para depois de outra. |
| `rename_section` | Altera o título, preservando a âncora quando explícita. |
| `set_frontmatter` | Define ou remove chaves do frontmatter. |
| `append` | Adiciona Markdown ao final do documento, útil na geração em etapas. |

### 10.6 Lint

Hierarquia de títulos com saltos, imagem sem texto alternativo, tabela sem cabeçalho, links quebrados para âncoras internas, seções vazias e trechos excessivamente longos sem subtítulo.

### 10.7 Editor e visualização

- Tiptap com o núcleo MIT e apenas as extensões que correspondem ao dialeto. Colagem de conteúdo externo é saneada e convertida no dialeto.
- O editor serializa para Markdown e calcula operações `replace_section` apenas das seções alteradas, em relação à versão base do rascunho. As operações são aplicadas localmente; nada é enviado durante a edição.
- A barra de comandos segue o layout de editor de texto (estilo Word) e cobre tudo o que o dialeto expressa: estilo de parágrafo (normal e títulos 1 a 3), negrito, itálico, tachado, código, link, limpar formatação, listas com marcadores, numeradas e de tarefas, recuo, citação, bloco de código, linha horizontal, alertas (Nota, Dica, Importante, Aviso, Cuidado) e tabela. Os comandos de linha e coluna aparecem apenas com o cursor numa tabela. Desfazer, refazer, status e salvar vêm do rascunho do host. A página tem largura A4 e a visualização usa o mesmo layout.
- O marcador de alerta sai escapado pelo serializador do Tiptap (`\[!WARNING\]`); a validação e o editor o desescapam para `[!WARNING]`, que é a forma do dialeto.
- Visualização em modo leitura pelo mesmo Tiptap, com tipografia do tema.

### 10.8 Exportação

`md` (o próprio conteúdo), `html` (estático e autocontido), `docx` (exportador próprio com `docx`: estilos de título para sumário, numeração de listas, tabelas, alertas como blocos sombreados, capa a partir do frontmatter, cabeçalho e rodapé com número de página) e `pdf` (render headless do visualizador em modo impressão).

## 11. Adaptador de planilha (Univer)

### 11.1 Formato e execução

- Conteúdo salvo: `IWorkbookData` do Univer, na versão fixada pelo adaptador.
- O servidor mantém um pool de instâncias headless do Univer (núcleo aberto, com o motor de fórmulas) em workers isolados. Toda operação do agente é executada numa instância: carrega o snapshot, aplica os comandos, recalcula as fórmulas e devolve o novo snapshot.
- Instâncias têm tempo limite por lote, limite de memória e reciclagem periódica. Indisponibilidade retorna `ENGINE_UNAVAILABLE`.
- O valor calculado de cada fórmula fica gravado no snapshot, de modo que leitura e exportação não dependem de nova execução.

### 11.2 Validação

- Estrutura do `IWorkbookData` validada por esquema mantido pelo adaptador para a versão fixada.
- Abas com nome de até 31 caracteres e sem `\ / ? * [ ] :`; ids de aba únicos.
- Após o recálculo, erros de fórmula (`#REF!`, `#DIV/0!`, `#NAME?`, `#VALUE!`) e referências circulares são devolvidos como avisos com a célula e a fórmula.
- Funções com efeito externo e scripts não são permitidos.

### 11.3 Leitura compacta

| Modo | Conteúdo |
|---|---|
| `outline` | Abas com id, nome, intervalo usado, quantidade de fórmulas, painéis congelados e intervalos nomeados. |
| `range` | Grade A1 de um intervalo, com valor exibido, fórmula e formato de cada célula preenchida. |
| `full` | Todas as abas em grade A1, respeitando o orçamento de tokens, com cursor para continuação. |

Exemplo:

```
Aba "Resumo" (id: resumo) A1:D3
A1 "Perfil" | B1 "Horas" | C1 "Valor hora" | D1 "Total"
A2 "Tech Lead" | B2 =SUMIF(Estimativa!C:C,A2,Estimativa!E:E) → 120 | C2 165 [moeda] | D2 =B2*C2 → 19.800,00 [moeda]
```

### 11.4 Operações

Cada operação é traduzida em comandos do Univer pela camada de fachada. O agente nunca escreve o `IWorkbookData`.

| Operação | Efeito |
|---|---|
| `set_values` | Define valores e fórmulas num intervalo a partir de uma matriz; texto iniciado por `=` vira fórmula. |
| `set_format` | Aplica formato numérico (inteiro, decimal, percentual, moeda do locale, data) a um intervalo. |
| `set_style` | Negrito, itálico, cores por token do tema, alinhamento, quebra de texto e bordas num intervalo. |
| `fill_range` | Preenche um intervalo a partir de uma célula modelo, ajustando referências relativas. |
| `insert_rows`, `delete_rows`, `insert_columns`, `delete_columns` | Desloca células e reescreve referências afetadas. |
| `add_sheet`, `rename_sheet`, `move_sheet`, `remove_sheet` | Gestão de abas. |
| `merge`, `unmerge` | Mesclagens. |
| `set_column_width`, `set_row_height`, `set_frozen` | Layout. |
| `set_validation` | Lista suspensa de valores permitidos. |
| `clear_range` | Limpa valores, formatos ou ambos. |

### 11.5 Lint

Fórmula com erro, número gravado como texto, total digitado em vez de calculado, fórmula referenciando célula vazia e coluna estreita para o conteúdo.

### 11.6 Editor e visualização

- Univer no navegador com apenas os pacotes do núcleo aberto: edição de células e fórmulas, formatação, abas, mesclagens, validação de dados, formatação condicional, filtros e ordenação.
- O editor escuta os comandos executados pelo usuário e os converte nas operações da seção 11.4, agrupadas em lotes aplicados ao rascunho local. Desfazer e refazer são locais. Salvar entrega o rascunho ao harness.
- Modo leitura pelo mesmo componente com edição desabilitada.
- O tema da planilha é gerado a partir do tema do artkit (claro e escuro): a faixa, as abas, os menus e a seleção usam o verde e os grafites do design system, e a interface usa a fonte do corpo. A grade desenhada em canvas segue a fonte e as cores padrão do Univer.

### 11.7 Exportação

`xlsx` (exportador próprio com ExcelJS a partir do `IWorkbookData`: fórmulas com valor calculado, formatos numéricos, estilos, mesclagens, painéis congelados e validações), `csv` por aba e `pdf` (render headless).

## 12. Camada visual (OpenUI Lang)

### 12.1 Formato

- Conteúdo salvo: OpenUI Lang, linguagem compacta e escrita linha a linha, em que cada declaração nomeada instancia um componente registrado.
- O primeiro componente da raiz define o tipo visual do artefato e as exportações disponíveis: `Deck` (slides), `Dashboard`, `Report`, `Prototype` ou `Diagram`.

Exemplo:

```
root = Deck([capa, escopo])
capa = Slide("title", [Title("Portal de Fornecedores"), Subtitle("Grupo Meridiano")])
escopo = Slide("title-content", [Title("Escopo em 13 módulos"), Bullets(["Cadastro e homologação", "Integração Protheus"])])
```

### 12.2 Biblioteca de componentes `@artkit/openui-components`

Componentes definidos com `defineComponent` e reunidos com `createLibrary`, cada um com esquema de propriedades e descrição para o modelo.

| Grupo | Componentes |
|---|---|
| Layout | `Page`, `Section`, `Grid`, `Columns`, `Card`, `Divider` |
| Texto | `Title`, `Subtitle`, `Heading`, `Text`, `Bullets`, `Callout`, `Quote`, `Image` |
| Dados | `StatCard`, `Table`, `BarChart`, `LineChart`, `PieChart`, `StackedBarChart`, `Progress`, `Badge` |
| Slides | `Deck`, `Slide` (layouts `title`, `section`, `title-content`, `two-columns`, `big-number`, `title-image`, `comparison`, `quote`), `Notes` |
| Dashboard e relatório | `Dashboard`, `Report`, `Filter`, `KpiRow` |
| Protótipo | `Prototype`, `Screen`, `Nav`, `Form`, `Input`, `Select`, `Button`, `Modal` (interações limitadas a navegação entre telas e estados simples) |
| Diagrama | `Diagram` (fluxograma, arquitetura, sequência), conforme decisão em aberto da seção 27 |

Regras dos slides: canvas 16:9 fixo; o conteúdo é organizado por layouts e slots, sem coordenadas livres, para evitar erros de posicionamento; `Notes` carrega as notas do apresentador.

### 12.3 Validação

- Parse pelo parser do OpenUI.
- Cada declaração validada contra o esquema do componente; referências a declarações inexistentes, ciclos e declarações órfãs são detectados.
- Componentes não registrados são rejeitados. Não há HTML bruto nem JavaScript arbitrário.
- URLs de imagens e links restritas a `asset://` e domínios permitidos.

### 12.4 Leitura compacta

| Modo | Conteúdo |
|---|---|
| `outline` | Árvore de declarações a partir da raiz, com nome e componente (e título de cada slide). |
| `statements` | Texto das declarações pedidas por nome. |
| `full` | OpenUI Lang completo, respeitando o orçamento de tokens. |

### 12.5 Operações

| Operação | Efeito |
|---|---|
| `set_statement` | Cria ou substitui uma declaração pelo nome. |
| `remove_statement` | Remove uma declaração; falha se ainda for referenciada, a menos que `cascade` seja informado. |
| `rename_statement` | Renomeia e atualiza todas as referências. |
| `insert_child` | Insere uma referência na lista de filhos de uma declaração, numa posição ou após outro filho. |
| `remove_child`, `move_child` | Remove ou reordena filhos, por exemplo slides de um Deck. |

### 12.6 Lint

Estimativa de estouro de texto por slide e por card, slide sem título, excesso de marcadores por slide, gráfico sem rótulos, imagem sem texto alternativo e declarações não usadas.

### 12.7 Renderização

- `Renderer` do OpenUI com a biblioteca do `artkit` e o tema aplicado.
- Renderização progressiva durante o streaming, alimentada por `parsePartial`.
- Deck com modo apresentação em tela cheia, miniaturas e notas.
- Sem edição visual pelo usuário no formato de visuais (decisão 3A); o painel oferece visualização e exportação.

### 12.8 Exportação

- `pdf` e `png` para todos os tipos visuais, por render headless do próprio renderer.
- `html` autocontido.
- `pptx` editável para `Deck`: exportador próprio que mapeia cada layout e componente para elementos nativos do pptxgenjs (textos, marcadores, tabelas e gráficos nativos com a paleta do tema, imagens, notas do apresentador). Diagramas dentro de slides entram como imagem.

## 13. Matriz de exportação

| Artefato | md | html | docx | xlsx | csv | pptx | png | pdf |
|---|---|---|---|---|---|---|---|---|
| Documento | sim | sim | sim | | | | | sim |
| Planilha | | | | sim | sim | | | sim |
| Slides (Deck) | | sim | | | | sim | sim | sim |
| Dashboard, relatório, protótipo, diagrama | | sim | | | | | sim | sim |

Cada exportador publica a lista do que é e do que não é suportado no formato de destino e devolve avisos de degradação controlada.

## 14. Camada React

### 14.1 Componentes

| Componente | Função |
|---|---|
| `<ArtifactProvider>` | Registro, tema, locale, cliente de dados e carregadores sob demanda dos visualizadores e editores. |
| `<ArtifactPanel>` | Painel lateral com as abas de visualização, edição e código, e o menu de exportação. |
| `<ArtifactView>` | Escolhe o visualizador pelo formato: Tiptap, Univer ou renderer OpenUI. |
| `<ArtifactEditor>` | Editor para Markdown e planilha; para OpenUI, cai para `ArtifactView`. |
| `<ArtifactCard>` | Cartão dentro da mensagem do chat, com título, tipo, versão e ação de abrir. |

### 14.2 Hooks e cliente de dados

`useArtifact`, `useApplyOperations` e `useArtifactExport`, apoiados numa interface `ArtifactClient` com implementação HTTP de referência para as rotas de `@artkit/node`. A camada React não acessa o store diretamente.

### 14.3 Requisitos comuns dos editores (documento e planilha)

- Toda edição vira operações do adaptador, enviadas com `baseVersion`.
- Interações próximas no tempo são agrupadas numa única etapa de desfazer.
- A alteração aparece imediatamente no rascunho local. Um lote rejeitado não altera o rascunho e mostra o erro.
- Desfazer e refazer são locais ao rascunho. Nada é gravado até a ação de salvar.
- Ação de salvar: emite `onSave` com `{ artifactId, format, baseVersion, title, locale, themeId, content, operations }`. O harness decide o que salvar significa (versão, armazenamento, sincronização) e devolve o artefato salvo. Se o agente gravar outra versão durante a edição, o rascunho com edições é mantido e a base passa a ser a versão nova; o salvamento seguinte é decisão do harness.
- Com o artefato bloqueado pelo agente, o editor fica em modo leitura e mostra a prévia em streaming.
- Operação completa por teclado e foco visível.
- Cada editor é carregado sob demanda, apenas ao entrar em modo de edição.

## 15. Integração com agentes

### 15.1 Toolkit

```ts
const toolkit = createArtifactToolkit({
  registry,             // adaptadores Markdown, planilha e OpenUI
  store,
  assets,
  authorize,            // (ação, artefato, ator) => boolean | Promise<boolean>
  logger,
});
```

| Ferramenta | Entrada | Saída |
|---|---|---|
| `artifact_create` | `format`, `title`, `content` (Markdown, OpenUI Lang ou, para planilha, um lote inicial de operações) | `id`, `version`, referências criadas, avisos |
| `artifact_read` | `id`, `mode`, recorte (âncoras, intervalo A1, declarações), `maxTokens`, `cursor` | leitura compacta e `cursor` |
| `artifact_apply` | `id`, `baseVersion`, `operations[]` | nova `version`, referências criadas, diff, avisos |
| `artifact_export` | `id`, `format` | referência do arquivo e avisos de fidelidade |
| `artifact_list` | filtros | lista paginada |
| `artifact_guide` | `topic` | instruções da skill sob demanda, para harnesses sem suporte a skills |

Para provedores com limite de tamanho de esquema, o toolkit gera `artifact_apply_markdown`, `artifact_apply_sheet` e `artifact_apply_openui` separados. Perfis de esquema `default`, `strict` e `compact` cobrem os modos estritos de cada provedor.

### 15.2 Formas de acoplamento

- **AI SDK, no mesmo processo (integração principal).** `@artkit/ai-sdk` entrega as ferramentas para o `ToolLoopAgent`. Store, usuário e workspace entram pelo contexto das ferramentas (`contextSchema` e `toolsContext`) e nunca pelos argumentos do modelo. Cada commit emite a data part `data-artifact` (`id`, `format`, `title`, `version`), atualizada no lugar pelo mesmo id.
- **Harness com ferramentas próprias (Pi, OpenCode, Claude Code).** Usa o toolkit quando o harness aceita registrar ferramentas; caso contrário, conecta ao `@artkit/mcp`. A pasta de skills é carregada pelo próprio harness.
- **Qualquer cliente MCP.** Recebe as mesmas ferramentas, recursos `artifact://{id}` com a leitura `outline` e prompts com as skills.

Os nomes de API do AI SDK 7 seguem a versão estável em uso no início do desenvolvimento e são cobertos por testes de contrato do adaptador.

### 15.3 Cliente

`useArtifacts(messages)` deriva dos parts do `useChat` o mapa de artefatos com a última versão conhecida, prévia em andamento (a partir do input em streaming da ferramenta e do `parsePartial` do adaptador). As mensagens carregam referência ao artefato, não o conteúdo, mantendo o histórico do chat pequeno.

### 15.4 Caminho de uma edição

1. O agente carrega a skill do formato e chama `artifact_read` em modo `outline`.
2. Chama `artifact_apply` com `baseVersion` e as operações.
3. O núcleo confere a versão e repassa ao adaptador, que valida e executa no formato nativo (no Univer headless, no caso da planilha).
4. O núcleo grava a versão, calcula diff e lint e devolve o resultado ao agente.
5. A aplicação recebe `data-artifact` e o painel recarrega o artefato.
6. Edições do usuário no Tiptap ou no Univer seguem o mesmo caminho a partir do passo 3; o agente as percebe pelo diff na leitura seguinte.

## 16. Skills

### 16.1 `artkit-artefatos` (uso em tempo de execução)

```
artkit-artefatos/
  SKILL.md                 escolha do formato, fluxo de trabalho, regras gerais, recuperação de erros
  references/
    documento.md           dialeto Markdown, âncoras, operações, checklist e anti-padrões
    planilha.md            leitura A1, operações, fórmulas, checklist e anti-padrões
    openui-base.md         sintaxe da OpenUI Lang, declarações e operações
    slides.md              Deck, layouts, limites por slide, notas
    dashboard.md           KPIs, gráficos, grade
    relatorio.md           Report, seções, tabelas e gráficos
    prototipo.md           telas, navegação, formulários
    diagrama.md            componente Diagram
    temas.md               tokens de cor e tipografia
    erros.md               cada código de erro com a correção esperada
  examples/                artefatos completos de referência
```

Conteúdo principal:

- **Escolha do formato:** texto para ler, revisar ou assinar vira documento; cálculo e totais viram planilha; apresentação, painel, relatório visual, protótipo ou diagrama viram OpenUI com a raiz correspondente.
- **Fluxo padrão:** ler o `outline` antes de editar; criar o esqueleto; completar em lotes; tratar avisos; exportar ou submeter.
- **Regras gerais:** usar sempre a `version` devolvida como próxima `baseVersion`; preferir operações pequenas a `replace_content`; cores por token do tema; nunca colar HTML.
- **Checklists por formato:** hierarquia de títulos e alertas para premissas no documento; totais sempre por fórmula, entradas separadas dos cálculos e aba de premissas na planilha; uma ideia por slide, título como afirmação e detalhe nas notas nos slides; rótulos curtos e uma direção dominante nos diagramas.

### 16.2 `artkit-integracao` (desenvolvimento)

Orienta agentes de código a integrar a biblioteca: instalar os pacotes com o gerenciador já usado no projeto, registrar adaptadores, tema, store e autorização, plugar o toolkit no `ToolLoopAgent` e o painel com `useArtifacts`, expor o MCP, adicionar componentes OpenUI próprios e evitar armadilhas (aceitar id de workspace vindo do modelo, gravar conteúdo fora do pipeline, carregar editores fora do subcaminho `/react`).

### 16.3 Geração e distribuição

- A parte técnica das referências (operações, componentes, propriedades, limites) é gerada a partir dos adaptadores e da biblioteca de componentes; a referência OpenUI aproveita a geração de instruções a partir da biblioteca oferecida pelo próprio OpenUI.
- Cada skill declara as versões da biblioteca e dos formatos que cobre. O CI valida todos os exemplos contra os adaptadores e falha em divergência.
- Distribuição pelo pacote npm e pelo repositório; `toolkit.skills()` devolve os arquivos para a aplicação gravar onde o harness espera; `artifact_guide` e prompts MCP cobrem harnesses sem suporte nativo.
- A aplicação estende as skills com regras próprias por arquivos sobrepostos, sem editar a skill base.

## 17. Armazenamento e ciclo de vida

### 17.1 Contratos

```ts
interface ArtifactStore {
  get(scope: Scope, id: string): Promise<StoredArtifact | null>;
  create(scope: Scope, input: NewArtifact): Promise<StoredArtifact>;
  commit(scope: Scope, id: string, change: Commit): Promise<StoredArtifact>; // lança VERSION_CONFLICT
  list(scope: Scope, filter: ArtifactFilter, page: PageRequest): Promise<Page<ArtifactSummary>>;
  lock(scope: Scope, id: string, actor: Actor, ttlMs: number): Promise<Lock>;
  unlock(scope: Scope, lock: Lock): Promise<void>;
}
```

`Scope` carrega workspace e ator; toda implementação filtra por escopo. O núcleo fornece uma suíte de testes de contrato para adaptadores de store. Adaptadores de referência: memória, sistema de arquivos e um exemplo em Postgres.

### 17.2 Ciclo de vida

A biblioteca não tem estados de publicação: o artefato existe, é editado e é exportado. Arquivamento, aprovação e publicação são decisões do harness (RFC 0001). Locks continuam válidos: um lock com expiração impede a edição de outro ator.

### 17.3 Eventos

`artifact.created`, `artifact.committed`, `artifact.conflict`, `artifact.exported` e `artifact.lint`, emitidos por barramento injetável.

## 18. Segurança

- Validação estrita de toda entrada, com limites de tamanho.
- Markdown sem HTML embutido; links restritos a `https`, `http`, `mailto` e âncoras internas.
- OpenUI restrito a componentes registrados, sem HTML bruto nem JavaScript; propriedades validadas por esquema.
- Planilha sem scripts e sem funções de efeito externo; exportação xlsx sem macros; `csv` com proteção contra injeção de fórmula.
- Univer headless em workers isolados, com tempo limite, limite de memória e sem acesso à rede.
- Render headless sem acesso à rede, com assets injetados.
- Isolamento por escopo no store e nos assets, com hook de autorização obrigatório no toolkit.
- Conteúdo de artefatos tratado como dado: a leitura compacta é delimitada e as skills orientam o modelo a não seguir instruções contidas em artefatos.

## 19. Observabilidade

Interface `Logger` injetável com campos estruturados (`artifactId`, `format`, `version`, `operationCount`, `durationMs`, `code`, `actorType`). Nunca registrar conteúdo de artefatos, textos de células, prompts ou dados pessoais. Ganchos de métricas para duração de `apply`, ocupação do pool do Univer, exportação, taxa de conflito e taxa de rejeição por código. Rastreamento compatível com OpenTelemetry via ganchos, sem dependência obrigatória.

## 20. Internacionalização e acessibilidade

- Formatação de números, moeda e datas por `locale` em todos os formatos.
- Mensagens de erro e textos de interface em pt-BR e en na versão 1.
- Semântica correta no Tiptap e nos componentes OpenUI, navegação por teclado no painel e nos editores, lint de acessibilidade (texto alternativo, contraste, hierarquia de títulos) e estrutura acessível preservada nos exportadores que suportam.

## 21. Desempenho

- Visualizadores e editores carregados sob demanda por formato.
- Pool do Univer headless dimensionável, com instâncias reaproveitadas e snapshot carregado por lote.
- Grade do Univer virtualizada no navegador.
- Exportação e render headless fora da thread principal.
- Orçamento de tamanho por pacote no CI e benchmarks nos limites de cada formato a cada release.

## 22. Extensibilidade

- Novos formatos por adaptador que implementa o contrato da seção 8 e passa na suíte de conformidade.
- Novos componentes OpenUI registrados pela aplicação na biblioteca, refletidos automaticamente nas instruções.
- Exportadores, temas e layouts de slide registráveis.
- Extensões Tiptap adicionais, desde que acompanhadas da regra de serialização Markdown correspondente.

## 23. Qualidade: testes e evals

### 23.1 Testes

| Camada | Estratégia |
|---|---|
| Núcleo | Pipeline, concorrência (`VERSION_CONFLICT`), locks e catálogo de erros. |
| Markdown | Invariante de ida e volta sobre um corpus de documentos; operações por seção; âncoras estáveis. |
| Planilha | Operações contra o Univer headless; recálculo; conferência de que o xlsx exportado recalculado no LibreOffice bate com os valores do snapshot. |
| OpenUI | Parser, validação de componentes, operações por declaração, detecção de órfãos e ciclos. |
| Exportadores | Verificação estrutural relendo o arquivo e conversão de fumaça em LibreOffice headless. |
| Renderização | Regressão visual com Playwright sobre o catálogo de exemplos. |
| Editores | Gestos gerando as operações esperadas, agrupamento de lotes e conflito com o agente. |
| Store | Suíte de contrato compartilhada. |
| Integração | Toolkit com modelo simulado e adaptador do AI SDK com stream simulado. |
| Migrações | Fixtures de cada versão de formato publicada. |

### 23.2 Evals

- Tarefas por formato: criar a partir de um briefing, editar um ponto específico, corrigir após erro, reorganizar, trabalhar em artefato grande com leitura paginada e tarefas que cruzam formatos (planilha de estimativa coerente com a proposta e com o deck).
- Métricas: validade na primeira tentativa, sucesso em até duas correções, operações por tarefa, tokens, avisos de lint e nota de qualidade por rubrica em amostra revisada por pessoas.
- Matriz: pelo menos dois provedores de modelo, perfis de esquema `default` e `strict`, e execução com e sem a skill.
- Metas iniciais a calibrar no primeiro ciclo: validade de pelo menos 90% em até duas tentativas por formato, ganho mensurável da skill e nenhuma regressão entre releases.

## 24. Documentação e experiência de desenvolvimento

Site com guias de início rápido (AI SDK, MCP, uso apenas no servidor), guia por formato, catálogo de componentes OpenUI com exemplos, referência de API gerada dos tipos, catálogo de erros e matriz de exportação. Playground público com os exemplos, aplicação de operações, leitura compacta e exportação. Exemplos executáveis: chat Next.js com AI SDK 7 e painel; script Node de geração e exportação; servidor MCP para clientes desktop.

## 25. Open core, licença e governança

| Aberto (Apache-2.0) | Comercial |
|---|---|
| `core`, os três adaptadores, `openui-components`, `react`, `node`, exportadores, `agent`, `ai-sdk`, `mcp`, `skills`, `evals` | Colaboração em tempo real, importação fiel de arquivos Office, pacotes de templates e identidade visual (componentes e skills), serviço gerenciado de versões, exportação e pool do Univer, suporte com SLA |

Governança: CLA para preservar a opção de licença dupla, política de marca, processo de RFC para mudanças no contrato de adaptador e na biblioteca de componentes, guia de contribuição, código de conduta, política de segurança e publicação automatizada no npm com proveniência.

## 26. Fases e entregáveis

### 26.1 Fase 1: núcleo aberto e três formatos

**Entregáveis.**

- `@artkit/core` completo: envelope, contrato de adaptador, pipeline com `baseVersion` estrito, migrações de formato, diff, catálogo de erros, contratos de store, assets e eventos.
- Adaptador Markdown com dialeto, âncoras, leitura por seções, operações, lint e editor Tiptap.
- Adaptador de planilha com pool do Univer headless, leitura A1, operações, lint e editor Univer.
- Adaptador OpenUI e biblioteca de componentes com layout, texto, dados, Deck e Slide, Dashboard, Report, Prototype e Diagram.
- Exportadores conforme a matriz da seção 13, incluindo pptx editável para Deck e xlsx por ExcelJS.
- `@artkit/react` com provider, painel, visualização, editores com rascunho local e ação de salvar, exportação, cartão e prévia em streaming.
- `@artkit/node` com stores de memória e sistema de arquivos, exemplo Postgres, assets, exportação e render headless.
- `@artkit/agent`, `@artkit/ai-sdk`, `@artkit/mcp` e `@artkit/skills`.
- Suíte de evals, site de documentação, playground e exemplos executáveis.
- CI com typecheck, lint, testes, orçamento de tamanho, verificação de licenças e publicação automatizada.

**Critérios de saída.**

- Metas de evals atingidas nos três formatos e nos dois provedores de referência, com ganho mensurável da skill.
- Exportações abertas sem erro no Microsoft Office, no LibreOffice e no Google, com a matriz de fidelidade documentada.
- Valores das planilhas exportadas conferidos após recálculo no LibreOffice e no Excel para os exemplos oficiais.
- Exemplo com AI SDK 7 funcionando de ponta a ponta: criação com prévia em streaming, edição incremental pelo agente, edição humana no Tiptap e no Univer, conflito resolvido, salvamento pelo harness e exportação.

## 27. O que mudou em relação à versão 0.2

- O padrão de dados próprio foi substituído por formatos nativos: Markdown, `IWorkbookData` do Univer e OpenUI Lang.
- Os tipos próprios de documento, planilha, slides, diagrama e app foram substituídos por três adaptadores e pela biblioteca de componentes OpenUI.
- Saíram o motor de fórmulas próprio (substituído pelo motor do Univer), os editores de slides e diagrama (visuais passam a ser editados pelo agente) e o sandbox do tipo `app` (o OpenUI aceita apenas componentes registrados).
- Os editores passaram a ser Tiptap para documento e Univer para planilha.
- Entraram o pool do Univer headless, a ferramenta `artifact_guide` em todas as integrações e as referências de skill por tipo visual.
- Versão 0.4 (RFC 0001): saem o histórico e a restauração, o arquivamento, a aprovação e a publicação, o campo `status` do envelope, `artifact_submit`, `idempotencyKey` e o rebase do `baseVersion`. `baseVersion` precisa ser a versão atual. O editor trabalha com rascunho local e a ação de salvar emite `onSave` ao harness. Visual de componentes e Markdown segue os tokens do design system Mouts, claro e escuro.
