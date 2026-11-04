# artkit: especificação da biblioteca de artefatos para agentes de IA

| Campo | Valor |
|---|---|
| Documento | Plano e especificação de desenvolvimento |
| Versão | 0.2 (rascunho para validação; editores de slides e planilha na fase 1 e skills de orientação para agentes) |
| Data | 04/11/2026 |
| Nome do projeto | `artkit` (nome provisório, sujeito a verificação no npm e no INPI) |
| Licença pretendida | Apache-2.0 para o núcleo aberto, com módulos comerciais separados |
| Integração de referência | Vercel AI SDK 7 (APIs de agente), com camada agnóstica de harness |
| Base técnica | POC de validação dos tipos (documento, planilha, slides e diagrama) já construída |

---

## 1. Visão geral

O `artkit` é uma biblioteca open source para React e Node que permite a agentes de IA criar, ler, editar, renderizar e exportar artefatos ricos: documentos (Markdown e Word), planilhas, apresentações, diagramas e, numa segunda fase, componentes HTML e React isolados.

A biblioteca resolve três problemas que hoje cada produto resolve sozinho e de forma frágil:

- **Um padrão de dados fácil para modelos.** Cada artefato é um JSON tipado, pequeno e legível, com identificadores semânticos. O modelo não escreve XML do Office, HTML livre nem coordenadas arbitrárias sem necessidade.
- **Edição incremental e segura.** O agente altera artefatos por operações validadas (inserir bloco, alterar células, mover slide), não regravando o conteúdo inteiro. Toda operação é validada, aplicada de forma atômica e versionada.
- **Uma única fonte da verdade para tudo.** O mesmo JSON alimenta a visualização React, os editores visuais, a projeção textual lida pelo modelo e os exportadores (docx, xlsx, pptx, svg, png, pdf, md).

A biblioteca não depende de um motor de agente específico. O pacote de agente expõe as ferramentas num formato neutro e adaptadores finos as entregam ao AI SDK 7, a servidores MCP e a outros harnesses.

## 2. Objetivos e não objetivos

### 2.1 Objetivos

- Definir um padrão de dados aberto, versionado e documentado para artefatos gerados por IA, com JSON Schema publicado por tipo.
- Oferecer um núcleo pequeno (dependência única: `zod`) com registro de tipos, motor de operações, versionamento, migrações, diff, lint e projeção textual.
- Entregar quatro tipos estáveis na versão 1: documento, planilha, slides e diagrama, cada um com renderização React, exportação e projeção textual.
- Entregar editores visuais para os quatro tipos na versão 1 (documento, planilha, slides e diagrama), gerando as mesmas operações usadas pelo agente.
- Publicar skills de orientação que ensinam agentes a usar a biblioteca: uma para criar e editar artefatos em tempo de execução e outra para integrar a biblioteca em aplicações.
- Integrar com o Vercel AI SDK 7 de forma nativa: tools, aprovação humana, streaming de prévia e hook de cliente.
- Expor as mesmas capacidades via MCP para clientes fora do AI SDK.
- Medir objetivamente a facilidade para IA por meio de evals por tipo e por modelo, usados como critério de saída de cada release.

### 2.2 Não objetivos da versão 1

- Importação fiel de arquivos Office existentes (docx, xlsx, pptx para JSON). Entra como módulo comercial.
- Colaboração simultânea em tempo real. Entra como módulo comercial.
- Substituir suítes de escritório. O foco é o artefato produzido e revisado com IA, não a edição livre de documentos arbitrários.
- Gerar HTML livre nos tipos estruturados. HTML e React arbitrários existem apenas no tipo `app`, sempre isolado em sandbox.

## 3. Princípios de design

- **JSON canônico como fonte da verdade.** Renderização, edição, projeção e exportação derivam do JSON salvo. Nenhum formato derivado é editado diretamente.
- **Semântica antes de geometria.** O modelo descreve intenção (layout "título e conteúdo", nó do tipo "banco de dados", célula com formato "moeda"). Posicionamento absoluto existe, mas é o caminho secundário.
- **Operações pequenas e verificáveis.** Toda alteração é uma lista de operações tipadas, validadas antes e depois da aplicação. Falha em qualquer operação descarta o lote inteiro.
- **Erros escritos para o modelo corrigir.** Toda rejeição traz código, caminho exato e dica de correção em linguagem natural.
- **Identificadores legíveis.** Blocos, nós, abas e elementos usam ids curtos e semânticos (`escopo`, `m01`, `api`), escolhidos pelo modelo ou gerados de forma determinística.
- **Aplicação pura e determinística.** `apply` não lê relógio, rede nem aleatoriedade. A mesma sequência de operações sempre produz o mesmo conteúdo, o que permite replay, auditoria e testes de propriedade.
- **Agnóstico de harness e de provedor.** Nenhum pacote do núcleo importa o AI SDK, React ou APIs de Node. Adaptadores ficam em pacotes separados.
- **Dependências mínimas e permissivas.** Cada dependência externa precisa de justificativa técnica e licença compatível com Apache-2.0.
- **Segurança por padrão.** Validação estrita de entrada, nenhum HTML bruto nos tipos estruturados, sandbox sem mesma origem para o tipo `app`, menor privilégio em armazenamento e ponte de comunicação.
- **Responsabilidade única por módulo.** Esquema, operações, projeção, lint, renderização, edição e exportação de cada tipo ficam em módulos separados.

## 4. Conceitos e glossário

| Termo | Definição |
|---|---|
| Artefato | Unidade persistida e versionada de conteúdo (um documento, uma planilha, um deck, um diagrama, um app). |
| Tipo (kind) | Definição de um tipo de artefato: esquema de conteúdo, operações, projeção, lint, diff e migrações. |
| Envelope | Registro que envolve o conteúdo com metadados de sistema (id, tipo, versões, status, autoria). |
| Conteúdo | Parte do envelope escrita pelo agente ou pelo usuário, validada pelo esquema do tipo. |
| Operação | Alteração tipada e atômica sobre o conteúdo de um tipo. |
| Lote | Lista de operações aplicadas juntas, gerando uma nova versão. |
| Projeção | Representação textual compacta do artefato, otimizada para leitura pelo modelo. |
| Lint | Verificação não bloqueante de qualidade (texto estourando caixa, imagem sem texto alternativo). |
| Diff | Resumo estrutural das mudanças entre duas versões. |
| Exportador | Conversor do conteúdo para um formato de arquivo. |
| Renderer | Componente React que exibe o conteúdo em modo leitura. |
| Editor | Componente React que permite edição visual e emite operações. |
| Toolkit | Conjunto de ferramentas de agente geradas a partir do registro de tipos. |
| Store | Adaptador de persistência de artefatos, versões e histórico. |
| Asset | Binário referenciado por artefatos (imagem, fonte, arquivo anexo). |

## 5. Arquitetura

### 5.1 Camadas

```
┌─────────────────────────────────────────────────────────────────┐
│ Aplicação (chat, painel, backend do produto)                    │
├───────────────────────┬───────────────────────┬─────────────────┤
│ @artkit/react         │ @artkit/ai-sdk        │ @artkit/mcp     │
│ painel, hooks, tema   │ adaptador AI SDK 7    │ servidor MCP    │
├───────────────────────┴───────────┬───────────┴─────────────────┤
│ @artkit/agent: toolkit neutro, instruções, formatação de erros   │
├───────────────────────────────────┴─────────────────────────────┤
│ Tipos: @artkit/kind-document | kind-sheet | kind-slides |        │
│        kind-diagram | kind-app (fase 2)                          │
│        subcaminhos: . (modelo) | /react | /edit | /export        │
├─────────────────────────────────────────────────────────────────┤
│ @artkit/core: envelope, registro, operações, versões, migrações, │
│ diff, lint, projeção, erros, contratos de store e de eventos     │
├─────────────────────────────────────────────────────────────────┤
│ @artkit/node: stores, assets, execução de exportação, render     │
│ headless (png, pdf), compilação do tipo app (fase 2)             │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Pacotes

| Pacote | Responsabilidade | Fase |
|---|---|---|
| `@artkit/core` | Envelope, contrato de tipo, registro, motor de operações, versionamento, migrações, diff, lint, projeção, catálogo de erros, contratos de store, assets e eventos. | 1 |
| `@artkit/kind-document` | Documento rico com entrada e saída em Markdown e exportação docx e pdf. | 1 |
| `@artkit/kind-sheet` | Planilha com fórmulas, formatos, estilos, mesclagens e várias abas. | 1 |
| `@artkit/kind-slides` | Apresentação com layouts semânticos, elementos posicionados, tabelas e gráficos. | 1 |
| `@artkit/kind-diagram` | Diagrama de nós, arestas e grupos com layout automático. | 1 |
| `@artkit/react` | Host de visualização, painel, hooks, streaming de prévia, tema, componentes de aprovação. | 1 |
| `@artkit/node` | Stores de referência (memória e sistema de arquivos), store de assets, orquestração de exportação, render headless. | 1 |
| `@artkit/agent` | Toolkit neutro, geração de instruções por tipo, formatação de erros para modelo, orçamento de tokens. | 1 |
| `@artkit/ai-sdk` | Adaptador para o AI SDK 7: tools, aprovação, contexto, data parts e hook `useArtifacts`. | 1 |
| `@artkit/mcp` | Servidor MCP com as mesmas ferramentas e recursos de leitura. | 1 |
| `@artkit/skills` | Skills de orientação para agentes (uso em tempo de execução e integração), geradas a partir do registro de tipos. | 1 |
| `@artkit/kind-app` | Componentes HTML e React isolados (tipo `app`). | 2 |
| `@artkit/sandbox` | Host de iframe, ponte JSON-RPC compatível com MCP Apps, política de capacidades. | 2 |
| `@artkit/cli` | Validar, exportar, renderizar e inspecionar artefatos pela linha de comando. | 2 |
| `@artkit/evals` | Suíte de avaliação por tipo e por modelo (uso interno e por contribuidores). | 1 |

Cada pacote de tipo publica subcaminhos independentes para que o consumidor carregue apenas o necessário:

| Subcaminho | Conteúdo | Dependências permitidas |
|---|---|---|
| `.` | Esquema, operações, projeção, lint, diff, migrações, instruções | `@artkit/core`, `zod` |
| `/react` | Renderer de leitura | `react` |
| `/edit` | Editor visual | `react` e a biblioteca de edição do tipo |
| `/export` | Exportadores | Biblioteca do formato (docx, exceljs, pptxgenjs) |

### 5.3 Regras de dependência

- `@artkit/core` não importa React, APIs de Node, DOM nem o AI SDK.
- O subcaminho `.` de cada tipo roda em navegador, Node, edge e workers.
- `@artkit/agent` depende apenas de `core` e dos tipos registrados; não conhece o AI SDK.
- `@artkit/ai-sdk` tem `ai` como peer dependency; `@artkit/react` tem `react` como peer dependency.
- Renderização headless (png e pdf) usa Playwright como peer dependency opcional de `@artkit/node`.
- Nenhum pacote lê variáveis de ambiente. Toda configuração entra por parâmetro e é validada na criação do objeto. As aplicações de exemplo centralizam e validam suas próprias variáveis.
- Dependências circulares entre pacotes são bloqueadas no CI.

### 5.4 Dependências externas previstas

| Dependência | Uso | Licença | Observação |
|---|---|---|---|
| `zod` 4 | Esquemas, validação e geração de JSON Schema | MIT | Única dependência do núcleo. |
| `docx` | Exportação Word | MIT | Validada na POC. |
| `exceljs` | Exportação Excel | MIT | Validada na POC, incluindo fórmulas com valor em cache. |
| `pptxgenjs` | Exportação PowerPoint | MIT | Validada na POC. |
| `@dagrejs/dagre` | Layout automático de diagramas | MIT | Padrão. |
| `elkjs` | Layout para diagramas grandes | EPL-2.0 | Opcional e isolado; exige análise jurídica antes de virar padrão. |
| `@tiptap/core` e extensões MIT | Editor de documento | MIT | Sem extensões Pro. |
| `@xyflow/react` | Editor de diagrama | MIT |  |
| `mdast-util-from-markdown` e extensão GFM | Entrada em Markdown | MIT | Parser de Markdown para blocos. |
| `@modelcontextprotocol/sdk` | Servidor MCP | MIT |  |
| `playwright` | Render headless para png e pdf | Apache-2.0 | Peer opcional. |
| Motor de fórmulas (a decidir) | Recálculo de planilha no servidor e no navegador | MIT ou Apache-2.0 | Candidatos: IronCalc (WASM) e fast-formula-parser. Precisa rodar nos dois ambientes. Ver decisões em aberto. |
| `react-moveable` | Editor de slides (mover, redimensionar, guias de alinhamento) | MIT |  |
| Glide Data Grid | Editor de planilha (grade em canvas virtualizada) | MIT |  |
| `esbuild` | Compilação do tipo `app` | MIT | Fase 2. |

Ficam vetadas no núcleo aberto, por licença ou modelo comercial: HyperFormula (GPLv3 ou comercial), BlockNote XL (GPL), PPTist (AGPL), tldraw (chave de licença em produção) e extensões TipTap Pro.

### 5.5 Ambiente suportado

- TypeScript estrito, distribuído como ESM com tipos.
- Node 22 ou superior; navegadores modernos (duas últimas versões de Chrome, Edge, Firefox e Safari).
- React 19 para os pacotes de interface.
- Runtimes edge suportados para `core`, tipos (subcaminho `.`), `agent` e `ai-sdk`. Exportadores binários rodam em Node e, quando a biblioteca de formato permitir, também no navegador.

## 6. Padrão de dados

### 6.1 Envelope

O envelope separa campos de sistema, que o agente nunca escreve, do conteúdo, que é o único objeto produzido pelo modelo.

```json
{
  "id": "art_01JBX7Q2N4ZK8T3M6W5R9YH2DC",
  "kind": "document",
  "schemaVersion": 1,
  "version": 7,
  "title": "Proposta técnica: Portal de Fornecedores",
  "status": "draft",
  "locale": "pt-BR",
  "themeId": "default",
  "content": { "...": "validado pelo esquema do tipo" },
  "meta": {
    "createdAt": "2026-11-04T14:00:00Z",
    "updatedAt": "2026-11-04T14:32:10Z",
    "createdBy": { "type": "agent", "id": "agent-propostas" },
    "updatedBy": { "type": "user", "id": "usr_123" },
    "tags": ["proposta"]
  }
}
```

| Campo | Regra |
|---|---|
| `id` | Gerado pelo store. Prefixo `art_` seguido de ULID. |
| `kind` | Deve existir no registro. |
| `schemaVersion` | Versão do esquema do tipo com que o conteúdo foi gravado. Migrado na leitura quando antigo. |
| `version` | Inteiro monotônico por artefato. Cada lote aplicado gera nova versão. |
| `title` | 1 a 200 caracteres. Alterável por operação de envelope. |
| `status` | `draft`, `pending_approval`, `published` ou `archived`. |
| `locale` | Tag BCP-47. Define formatação de números, datas e moeda. |
| `themeId` | Referência a um tema registrado. |
| `content` | Objeto validado pelo `contentSchema` do tipo. |
| `meta` | Preenchido pelo store. Nunca exposto para escrita pelo agente. |

### 6.2 Identificadores internos

- Blocos, abas, slides, elementos, nós, arestas e grupos têm `id` no formato `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`.
- Ids são únicos dentro do escopo do tipo (por exemplo, ids de elementos são únicos dentro do deck inteiro, não apenas do slide), o que permite que operações referenciem qualquer item sem informar o pai.
- Na criação, o id é opcional. Quando omitido, o núcleo gera um id determinístico a partir do tipo do item e de um contador derivado dos ids existentes (`p12`, `n4`). O id gerado aparece na resposta da ferramenta e na projeção.
- Ids são estáveis: mover, editar ou reordenar não altera o id.

### 6.3 Versionamento de esquema e migrações

- Cada tipo declara `version` (versão atual do esquema) e uma lista ordenada de migrações `{ from, to, migrate(content) }`.
- Na leitura, conteúdo com `schemaVersion` menor é migrado em cadeia em memória. A persistência da versão migrada ocorre apenas no próximo commit.
- Conteúdo com `schemaVersion` maior que o suportado é rejeitado com `UNSUPPORTED_VERSION`.
- Mudanças que apenas adicionam campos opcionais não exigem nova versão de esquema. Remoção, renomeação ou mudança de semântica exigem.
- O versionamento semver dos pacotes é independente do `schemaVersion` dos tipos. Uma versão maior de pacote não pode remover suporte de leitura a uma versão de esquema publicada sem antes passar por um ciclo de depreciação.

### 6.4 Tema

O tema é compartilhado entre tipos, garantindo identidade visual consistente entre documento, planilha, slides e diagrama.

```json
{
  "id": "default",
  "colors": {
    "text": "#1D2F3C", "muted": "#5B6B78", "accent": "#14AB83",
    "background": "#FFFFFF", "surface": "#F3F6F8",
    "info": "#2563EB", "warning": "#D97706", "success": "#15803D", "danger": "#B91C1C"
  },
  "fonts": { "heading": "Calibri", "body": "Calibri", "mono": "Consolas" },
  "chartPalette": ["#14AB83", "#1D2F3C", "#5B8DEF", "#F2A541", "#9B59B6"]
}
```

- Conteúdos referenciam cores por token (`accent`, `muted`) ou por hexadecimal. Tokens são preferidos e são o que as instruções ensinam ao modelo.
- Renderers mapeiam tokens para variáveis CSS; exportadores mapeiam tokens para valores do formato.
- Temas são registrados na aplicação. Pacotes de identidade visual prontos são parte da oferta comercial.

### 6.5 Assets

- Imagens e anexos não entram no JSON. O conteúdo referencia `asset://<id>`.
- O `AssetStore` recebe bytes, valida tipo MIME por lista permitida (png, jpeg, webp, gif, svg sanitizado) e tamanho máximo, calcula hash e devolve a referência.
- URLs externas só são aceitas se a aplicação habilitar uma lista de domínios permitidos; caso contrário, o agente deve primeiro registrar o asset.
- Exportadores resolvem assets pelo store e os embutem no arquivo final.

### 6.6 Limites iniciais

Valores iniciais, configuráveis por registro, para proteger memória, contexto do modelo e tempo de exportação:

| Item | Limite inicial |
|---|---|
| Envelope serializado | 5 MB |
| Documento | 2.000 blocos; 200 linhas por tabela |
| Planilha | 20 abas; 50.000 células preenchidas; 16.384 colunas e 100.000 linhas endereçáveis |
| Slides | 100 slides; 60 elementos por slide |
| Diagrama | 300 nós; 600 arestas; 30 grupos |
| Operações por lote | 200 |

Violação retorna `LIMIT_EXCEEDED` com o limite e o valor encontrado.

## 7. Contrato de um tipo

Todo tipo, nativo ou de terceiros, implementa o mesmo contrato. O registro valida o contrato no momento do `register`.

```ts
interface ArtifactKind<Content, Operation> {
  kind: string; // 'document'
  version: number; // versão atual do esquema
  label: string; // 'Documento'

  contentSchema: z.ZodType<Content>;
  operationSchema: z.ZodType<Operation>;

  apply(draft: Content, op: Operation): void; // puro; muta o clone
  project(content: Content, options: ProjectionOptions): Projection;
  lint(content: Content): LintIssue[];
  diff(before: Content, after: Content): ChangeSummary[];
  parsePartial(raw: unknown): Content | undefined; // prévia durante streaming

  inputs?: Record<string, ContentInput<Content>>; // entradas alternativas (markdown, mermaid)
  migrations: Migration[];
  limits: KindLimits;
  instructions: KindInstructions; // texto e exemplos para o modelo
}

interface ContentInput<Content> {
  description: string; // exibido nas instruções do modelo
  schema: z.ZodType<unknown>; // formato da entrada
  toContent(input: unknown): Content; // conversão determinística
}

interface KindInstructions {
  summary: string; // o que é e quando usar
  rules: string[]; // regras curtas e verificáveis
  examples: { title: string; content?: unknown; operations?: unknown[] }[];
}
```

Exportadores e renderers são registrados separadamente, mantendo o subcaminho `.` livre de dependências pesadas:

```ts
interface ArtifactExporter<Content> {
  kind: string;
  format: 'docx' | 'xlsx' | 'pptx' | 'svg' | 'png' | 'pdf' | 'md' | 'html' | 'csv' | 'zip';
  mimeType: string;
  extension: string;
  runtime: 'any' | 'node' | 'browser';
  export(content: Content, ctx: ExportContext): Promise<Uint8Array>;
}

interface ExportContext {
  theme: Theme;
  locale: string;
  assets: AssetResolver;
  logger: Logger;
  signal?: AbortSignal;
}
```

## 8. Protocolo de operações

### 8.1 Formato

Cada operação é um objeto discriminado por `op`. Operações referenciam itens por id e nunca por índice, exceto quando o índice é a própria intenção (mover para a posição N).

```json
{
  "artifactId": "art_01JBX7Q2N4ZK8T3M6W5R9YH2DC",
  "baseVersion": 7,
  "idempotencyKey": "call_abc123",
  "operations": [
    { "op": "insert_block", "after": "escopo", "block": { "type": "paragraph", "id": "premissa-api", "runs": [{ "text": "O Protheus expõe APIs REST." }] } },
    { "op": "replace_text", "block": "intro", "find": "16 semanas", "replace": "18 semanas" }
  ]
}
```

### 8.2 Pipeline de aplicação

1. Validar o pedido (formato, limites, autorização da ação sobre o artefato).
2. Carregar o artefato e migrar o conteúdo se necessário.
3. Verificar `baseVersion` contra a versão atual (ver 8.3).
4. Validar cada operação com `operationSchema`. Erro em qualquer uma rejeita o lote com o índice da operação.
5. Clonar o conteúdo (`structuredClone`) e aplicar as operações em sequência sobre o clone.
6. Revalidar o conteúdo resultante inteiro com `contentSchema` e os limites do tipo.
7. Executar etapas derivadas do tipo, quando existirem (por exemplo, recálculo de fórmulas na planilha).
8. Calcular diff e lint.
9. Persistir via store com controle otimista de versão e registrar o lote no histórico.
10. Emitir evento `artifact.committed` e retornar nova versão, ids gerados, resumo do diff e avisos de lint.

Qualquer falha entre os passos 3 e 9 descarta o clone. O artefato nunca fica parcialmente alterado.

### 8.3 Concorrência

- O modelo de concorrência da versão 1 é otimista: `baseVersion` obrigatória em `apply`.
- Se `baseVersion` for menor que a atual, o núcleo tenta reaplicar o lote sobre a versão atual. Se todas as operações continuarem válidas e nenhuma tocar itens alterados no intervalo, o lote é aceito (rebase automático). Caso contrário, retorna `VERSION_CONFLICT` com o diff desde a versão base, para que o agente releia e refaça.
- Edições do usuário no editor visual também são operações, passam pelo mesmo pipeline e geram versões. O agente toma conhecimento delas pelo diff retornado no conflito ou numa nova leitura.
- Bloqueio opcional (`lock`) com expiração permite que o produto impeça edição humana enquanto o agente gera um artefato grande.
- `idempotencyKey` evita aplicar duas vezes o mesmo lote quando a chamada de ferramenta é repetida pelo harness.

### 8.4 Operações de envelope

Disponíveis para todos os tipos, tratadas pelo núcleo:

| Operação | Efeito |
|---|---|
| `set_title` | Altera o título. |
| `set_theme` | Troca o tema por id registrado. |
| `set_locale` | Troca o locale. |
| `replace_content` | Substitui o conteúdo inteiro. Permitida, mas desencorajada nas instruções para artefatos grandes. |

### 8.5 Histórico, desfazer e restauração

- Versões são imutáveis. O histórico guarda, por versão, o lote de operações, o autor, a mensagem opcional e um snapshot periódico (a cada N versões e sempre na primeira versão).
- Desfazer no editor gera uma nova versão com o conteúdo da versão anterior, preservando o histórico linear.
- Restaurar uma versão antiga gera uma nova versão com aquele conteúdo e registra a origem.
- O store permite reconstruir qualquer versão pelo snapshot mais próximo mais o replay dos lotes, o que é garantido pelo determinismo do `apply`.

### 8.6 Diff

`diff(before, after)` de cada tipo retorna mudanças estruturais legíveis por pessoas e modelos:

```json
[
  { "type": "added", "target": "block:premissa-api", "summary": "Parágrafo inserido após 'escopo'." },
  { "type": "changed", "target": "cell:Resumo!D14", "summary": "R$ 159.810,00 para R$ 162.910,00." },
  { "type": "moved", "target": "slide:cronograma", "summary": "Da posição 6 para a posição 4." }
]
```

O diff alimenta a tela de aprovação, o retorno das ferramentas e a mensagem de conflito.

## 9. Projeção textual

A projeção é o que o modelo lê. Ela é compacta, estável, inclui ids e mostra apenas o necessário para editar.

### 9.1 Modos

| Modo | Uso |
|---|---|
| `outline` | Estrutura com ids e títulos, sem corpo. Primeiro passo em artefatos grandes. |
| `full` | Conteúdo completo, respeitando o orçamento de tokens. |
| `range` | Recorte: intervalo de blocos, intervalo A1 de uma aba, slides por id ou índice, subgrafo de um grupo. |

### 9.2 Orçamento e paginação

- `read` aceita `maxTokens` (estimado por contagem de caracteres com fator configurável).
- Quando o conteúdo excede o orçamento, a projeção é truncada em fronteira de item e retorna `cursor` para continuação, junto com o `outline` do restante.

### 9.3 Exemplos por tipo

Documento (Markdown com âncora de id por bloco):

```
# Proposta técnica <!-- #titulo -->
## 1. Escopo <!-- #escopo -->
O portal centraliza o cadastro e a homologação de fornecedores. <!-- #escopo-p1 -->
| Módulo | Horas | Valor | <!-- #tabela-investimento -->
```

Planilha (grade A1 com fórmula e valor):

```
Aba "Resumo" (id: resumo) A1:D6
A1 "Perfil" | B1 "Horas" | C1 "Valor hora" | D1 "Total"
A2 "Tech Lead" | B2 =SUMIF(Estimativa!C:C,A2,Estimativa!E:E) → 120 | C2 165 [currencyBRL] | D2 =B2*C2 → 19800 [currencyBRL]
```

Slides:

```
Slide 3 (id: cronograma, layout: title-content)
  [titulo] text "Cronograma em 5 fases" (0.6,0.4 12.1x0.9)
  [gantt] table 6x17 (0.6,1.5 12.1x5.2)
  notas: "Reforçar que a fase 3 depende do acesso ao Protheus."
```

Diagrama:

```
direção: TB
grupo canais "Canais": web(box) "Portal web", app(round) "App mobile"
grupo dados "Dados": pg(cylinder) "PostgreSQL"
aresta e1: web -> api "HTTPS"
```

## 10. Validação, lint e erros

### 10.1 Validação

- Validação estrutural por `zod`, com mensagens em português e inglês selecionadas pelo locale do toolkit.
- Regras de integridade por tipo (ids únicos, referências existentes, linhas de tabela com o número de colunas do cabeçalho, elementos dentro dos limites do slide, arestas apontando para nós existentes).
- Saneamento de strings: remoção de caracteres de controle, normalização Unicode NFC e validação de protocolos de link (`https`, `http`, `mailto` e âncoras internas).

### 10.2 Lint

Lint não bloqueia o commit. Os avisos voltam para o agente na resposta da ferramenta e aparecem no painel.

| Tipo | Exemplos de regra |
|---|---|
| Documento | Hierarquia de títulos pulando nível; imagem sem texto alternativo; tabela sem cabeçalho; parágrafo vazio. |
| Planilha | Fórmula referenciando célula vazia; número gravado como texto; coluna estreita para o conteúdo; total sem fórmula. |
| Slides | Texto estimado excedendo a caixa; elementos sobrepostos sem intenção; contraste insuficiente; slide sem título. |
| Diagrama | Nó isolado; aresta duplicada; rótulo longo demais para a forma; grupo vazio. |

### 10.3 Catálogo de erros

Erros são centralizados no núcleo e têm formato único:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_OPERATION",
    "message": "A operação 2 é inválida.",
    "issues": [
      {
        "path": "operations[2].block.rows[1]",
        "message": "A linha tem 4 colunas e o cabeçalho tem 5.",
        "hint": "Informe 5 valores na linha ou ajuste o cabeçalho."
      }
    ]
  }
}
```

| Código | Situação |
|---|---|
| `UNKNOWN_KIND` | Tipo não registrado. |
| `DUPLICATE_KIND` | Registro duplicado de tipo. |
| `NOT_FOUND` | Artefato, versão, item ou asset inexistente. |
| `INVALID_ENVELOPE` | Envelope malformado. |
| `UNSUPPORTED_VERSION` | Versão de esquema superior à suportada. |
| `MIGRATION_FAILED` | Falha ao migrar conteúdo antigo. |
| `INVALID_CONTENT` | Conteúdo viola esquema ou integridade. |
| `INVALID_OPERATION` | Operação viola o esquema de operações. |
| `OPERATION_FAILED` | Operação válida que não pode ser aplicada ao estado atual (id inexistente, âncora não encontrada). |
| `VERSION_CONFLICT` | `baseVersion` desatualizada e rebase impossível. |
| `LOCKED` | Artefato bloqueado por outro autor. |
| `LIMIT_EXCEEDED` | Limite de tamanho ou quantidade excedido. |
| `PERMISSION_DENIED` | Ação negada pelo hook de autorização. |
| `APPROVAL_REQUIRED` | Ação depende de aprovação humana. |
| `ASSET_REJECTED` | Asset com tipo, tamanho ou origem não permitidos. |
| `EXPORT_FAILED` | Falha no exportador. |

- Mensagens para o modelo não incluem stack trace, caminhos de servidor ou dados de outros artefatos.
- A aplicação recebe o erro original encapsulado em `ArtifactError` com `cause`, para log e diagnóstico.

## 11. Tipos de artefato da versão 1

### 11.1 Documento (`document`), incluindo Markdown

**Objetivo.** Propostas, especificações, relatórios, atas, artigos e notas. Exporta para Word, PDF e Markdown.

**Decisão sobre Markdown.** Markdown é tratado como representação do tipo documento, não como tipo separado: o agente pode criar e substituir trechos enviando Markdown (subconjunto GFM), que é convertido em blocos; e o documento exporta para `.md`. Isso evita dois modelos de dados para o mesmo conteúdo e mantém edição incremental por id. A alternativa (tipo `markdown` de texto puro) está registrada nas decisões em aberto.

**Modelo de conteúdo.**

| Elemento | Campos |
|---|---|
| `cover` (opcional) | `eyebrow`, `title`, `subtitle`, `fields[{label, value}]` (até 8) |
| `page` (opcional) | `size` (A4, Letter), `orientation`, `margins`, `header`, `footer`, `pageNumbers` |
| Bloco `heading` | `level` 1 a 4, `runs` |
| Bloco `paragraph` | `runs`, `align` |
| Bloco `list` | `ordered`, `items[{runs, children?}]` com até 3 níveis |
| Bloco `table` | `header`, `rows`, `align[]`, `widths[]` (proporções), `footer[]`, `caption` |
| Bloco `callout` | `tone` (info, warning, success, danger), `title`, `runs` |
| Bloco `quote` | `runs`, `attribution` |
| Bloco `code` | `language`, `text` |
| Bloco `image` | `asset`, `alt` (obrigatório), `caption`, `width` (proporção) |
| Bloco `divider` | sem campos |
| Bloco `pageBreak` | sem campos |
| Bloco `toc` | `maxLevel` (sumário gerado na exportação e na renderização) |
| Run | `text`, `bold`, `italic`, `underline`, `strike`, `code`, `link`, `superscript`, `subscript` |

**Operações.**

| Operação | Efeito |
|---|---|
| `insert_block` | Insere um bloco após um id (ou no início). |
| `insert_markdown` | Converte Markdown em blocos e insere após um id. |
| `update_block` | Substitui campos de um bloco mantendo o id. |
| `remove_block` | Remove um bloco. |
| `move_block` | Move um bloco para depois de outro id. |
| `replace_text` | Substitui trecho por âncora textual em um bloco, preservando formatação dos runs quando possível. Falha se a âncora não for única. |
| `set_cover` | Define ou remove a capa. |
| `set_page` | Define configuração de página. |
| `table_set_cells`, `table_insert_row`, `table_remove_row` | Edição granular de tabelas. |

**Entradas alternativas.** `markdown` (criação a partir de Markdown GFM com tabelas, listas, citações, código e links).

**Renderização.** Visual de página contínua com tipografia do tema, capa, sumário calculado, tabelas com alinhamento e rodapé. Modo de impressão com quebras de página.

**Editor (fase 1).** Baseado em TipTap core. Um mapeamento bidirecional entre o documento ProseMirror e os blocos garante que cada transação do editor seja convertida em operações do tipo, preservando ids. Barra de formatação limitada ao que o esquema suporta; colagem de HTML externo é saneada e convertida no subconjunto.

**Exportação.** `docx` (estilos nativos de título para sumário do Word, numeração de listas, tabelas com cabeçalho repetido, callouts com sombreamento, capa com quebra de página, cabeçalho e rodapé com número de página), `pdf` (render headless do renderer em modo impressão), `md` (GFM), `html` (estático, autocontido).

### 11.2 Planilha (`sheet`)

**Objetivo.** Estimativas, orçamentos, cronogramas simples, controles e tabelas com cálculo.

**Modelo de conteúdo.**

| Elemento | Campos |
|---|---|
| Aba | `id`, `name` (até 31 caracteres, sem `\ / ? * [ ] :`), `columns` (largura 4 a 80), `rows` (altura), `frozen` (linhas e colunas), `cells`, `merges`, `validations`, `hidden` |
| Célula | `v` (valor ou valor em cache), `f` (fórmula), `fmt`, `s` (estilo), `note` |
| Formatos nomeados | `general`, `integer`, `decimal2`, `percent`, `currency` (moeda do locale), `date`, `datetime`, `text` |
| Estilo | `bold`, `italic`, `color`, `background`, `align`, `valign`, `wrap`, `border` |
| Intervalos nomeados | `names[{name, ref}]` no nível da pasta |
| Validação de dados | Lista de valores permitidos por intervalo |

**Fórmulas.**

- Subconjunto de funções suportadas, documentado e publicado nas instruções: aritméticas e agregações (`SUM`, `SUMIF`, `SUMIFS`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `COUNTIF`, `COUNTIFS`, `ROUND`, `ROUNDUP`, `ROUNDDOWN`), lógicas (`IF`, `IFS`, `AND`, `OR`, `NOT`, `IFERROR`), busca (`VLOOKUP`, `XLOOKUP`, `INDEX`, `MATCH`), texto (`CONCAT`, `TEXT`, `LEFT`, `RIGHT`, `LEN`, `UPPER`, `LOWER`, `TRIM`) e datas (`DATE`, `TODAY`, `EDATE`, `EOMONTH`, `NETWORKDAYS`, `WEEKDAY`).
- O núcleo valida sintaxe, funções permitidas e referências (abas e células existentes, sem referência circular).
- O servidor é a autoridade do cálculo: o pipeline de `apply` recalcula as células dependentes por meio da interface `FormulaEngine` e grava `v` como valor em cache. O agente não precisa calcular valores.
- O mesmo adaptador de `FormulaEngine` roda no navegador para que o editor mostre o resultado imediatamente após cada edição. O valor exibido é provisório até o commit confirmar; divergência entre navegador e servidor é registrada como erro de consistência.
- Funções com efeito externo (`WEBSERVICE`, `HYPERLINK` com protocolos não permitidos, chamadas a macros) são proibidas.

```ts
interface FormulaEngine {
  validate(formula: string, ctx: SheetContext): FormulaIssue[];
  recalculate(content: SheetContent, changed: CellRef[]): CellValueUpdate[];
}
```

**Operações.**

| Operação | Efeito |
|---|---|
| `set_cells` | Define valores, fórmulas, formatos e estilos de várias células; `null` remove. |
| `set_range_style`, `set_range_format` | Aplica estilo ou formato a um intervalo. |
| `insert_rows`, `delete_rows`, `insert_columns`, `delete_columns` | Desloca células e reescreve referências de fórmulas afetadas. |
| `add_sheet`, `rename_sheet`, `remove_sheet`, `move_sheet` | Gestão de abas, com reescrita de referências em renomeação. |
| `merge_cells`, `unmerge_cells` | Mesclagens. |
| `set_column_width`, `set_row_height`, `set_frozen` | Layout. |
| `set_name`, `remove_name` | Intervalos nomeados. |
| `set_validation` | Validação de lista. |
| `fill_range` | Preenche um intervalo a partir de uma célula modelo, ajustando referências relativas. Reduz muito o tamanho das chamadas do modelo. |

**Entradas alternativas.** `table` (cabeçalho e linhas, com tipos inferidos) e `csv`.

**Renderização.** Grade virtualizada com abas, mesclagens, quebra de texto, formatos do locale, linhas e colunas congeladas e destaque de fórmulas ao selecionar.

**Editor (fase 1).** Baseado em Glide Data Grid (grade em canvas, virtualizada), com comportamento próximo ao de planilhas de mercado:

- Edição de célula por digitação direta e por barra de fórmulas; entrada iniciada por `=` vira fórmula.
- Autocompletar restrito às funções suportadas, com assinatura e descrição; destaque colorido das referências da fórmula na grade; seleção de intervalo com mouse durante a edição da fórmula.
- Erros de fórmula exibidos na célula (`#REF!`, `#DIV/0!`, `#NAME?`) com explicação no foco.
- Seleção de células, linhas, colunas e intervalos múltiplos; navegação por teclado (setas, Tab, Enter, Ctrl+setas, Shift para estender).
- Copiar e colar com outras planilhas (TSV e HTML de tabela), convertido em `set_cells`; colar fórmulas ajusta referências relativas.
- Alça de preenchimento convertida em `fill_range`.
- Barra de formatação: formatos nomeados, negrito, itálico, cor do texto e do fundo por token do tema, alinhamento, quebra de texto e bordas.
- Inserir e excluir linhas e colunas, redimensionar colunas e linhas, congelar painéis, mesclar e desfazer mesclagem.
- Gestão de abas: criar, renomear, reordenar por arrastar, ocultar e excluir com confirmação.
- Lista suspensa nas células com validação de dados; edição de intervalos nomeados em diálogo próprio.
- Indicadores de lint na própria célula (número como texto, total sem fórmula).

**Exportação.** `xlsx` (fórmulas com valor em cache, formatos numéricos, estilos, mesclagens, painéis congelados, intervalos nomeados, validações), `csv` por aba, `pdf` (render headless).

### 11.3 Slides (`slides`)

**Objetivo.** Apresentações comerciais, executivas e técnicas, com exportação PowerPoint fiel.

**Decisão de modelagem.** Dois níveis convivem no mesmo slide. O nível semântico usa layouts com slots nomeados (o modelo preenche "título", "corpo", "coluna esquerda") e é o caminho ensinado por padrão, porque evita erros de coordenada. O nível livre usa elementos com posição e tamanho em polegadas no canvas 13,333 x 7,5, para composições específicas. Um slide pode combinar slots e elementos livres.

**Modelo de conteúdo.**

| Elemento | Campos |
|---|---|
| Deck | `size` (16:9), `slides`, `footer` opcional (texto, número de slide) |
| Slide | `id`, `layout`, `slots`, `elements`, `background`, `notes`, `hidden` |
| Layouts nativos | `title`, `section`, `title-content`, `two-columns`, `title-image`, `comparison`, `big-number`, `quote`, `blank` |
| Elemento `text` | `x`, `y`, `w`, `h`, `paragraphs` ou `bullets`, `fontSize` (8 a 96), `bold`, `color`, `align`, `valign` |
| Elemento `shape` | `shape` (rect, roundRect, ellipse, line, arrow), `fill`, `line`, `text` opcional |
| Elemento `image` | `asset`, `alt`, `fit` (contain, cover) |
| Elemento `table` | `header`, `rows`, `widths`, `fontSize`, estilos de cabeçalho |
| Elemento `chart` | `chartType` (bar, column, line, pie, stackedBar), `categories`, `series[{name, values}]`, `showValues`, `legend` |
| Cor | Token do tema ou hexadecimal |

**Operações.** `add_slide` (com layout e slots), `remove_slide`, `move_slide`, `duplicate_slide`, `set_layout`, `set_slot`, `set_notes`, `add_element`, `update_element` (não altera `id` nem `type`), `remove_element`, `reorder_element` (frente e trás), `set_background`.

**Lint específico.** Estimativa de ajuste de texto por métrica de fonte (largura média por caractere da família do tema) para avisar estouro antes da exportação; sobreposição de elementos; elementos fora do canvas são erro de validação, não aviso.

**Renderização.** Canvas responsivo com proporção fixa, posição em porcentagem e tamanho de fonte em unidades de contêiner (já validado na POC), modo apresentação em tela cheia, miniaturas e notas.

**Editor (fase 1).** Baseado em `react-moveable` sobre o próprio renderer, garantindo que o que se edita é o que se exporta:

- Painel de miniaturas com reordenação por arrastar, duplicar, ocultar, excluir e inserir slide escolhendo o layout.
- Troca de layout do slide, com migração do conteúdo dos slots equivalentes.
- Seleção simples e múltipla; mover, redimensionar com e sem proporção; teclado para ajuste fino.
- Guias inteligentes de alinhamento com bordas e centros de outros elementos e do slide; grade opcional com encaixe.
- Ferramentas de alinhar, distribuir e ordenar camadas (frente e trás).
- Edição de texto no lugar, restrita ao que o esquema suporta (parágrafos, marcadores, negrito, itálico, cor por token, tamanho e alinhamento), com indicador de estouro de caixa alimentado pelo lint.
- Inserção de texto, forma, imagem (upload pelo `AssetStore`), tabela e gráfico; tabela editável em grade; dados do gráfico editáveis numa mini planilha com prévia ao vivo.
- Seletor de cor limitado aos tokens do tema, com opção hexadecimal quando a aplicação permitir.
- Edição de notas do apresentador e do fundo do slide.
- Um gesto contínuo (arrastar, redimensionar) gera uma única operação `update_element` ao final, não uma por quadro.

**Exportação.** `pptx` (layouts mapeados para elementos nativos editáveis, tabelas e gráficos nativos com paleta do tema, notas do apresentador), `pdf` e `png` por slide (render headless).

### 11.4 Diagrama (`diagram`)

**Objetivo.** Arquiteturas, fluxos de processo, integrações e organogramas simples.

**Modelo de conteúdo.**

| Elemento | Campos |
|---|---|
| Diagrama | `direction` (TB, LR), `layout` (`auto`, `bands`, `manual`), `nodes`, `edges`, `groups` |
| Nó | `id`, `label` (até 60), `shape` (box, round, diamond, ellipse, cylinder, document, actor), `tone` (token), `group`, `icon` opcional (conjunto fechado), `position` opcional |
| Aresta | `id`, `from`, `to`, `label` (até 40), `style` (solid, dashed), `arrow` (end, both, none) |
| Grupo | `id`, `label`, `kind` (`band` para camadas ou raias, `box` para agrupamento) |

**Layout.**

- `auto`: dagre para grafos sem grupos.
- `bands`: layout em camadas (TB) ou raias (LR) com roteamento ortogonal, desenvolvido na POC e endurecido na versão 1 (canais livres entre bandas, rótulos no último segmento, redução de cruzamentos).
- `manual`: posições fixadas pelo usuário no editor são respeitadas; nós sem posição recebem layout automático incremental.
- Adaptador de layout plugável para permitir elkjs em diagramas grandes, mantido como opcional pela licença EPL-2.0.

**Operações.** `add_node`, `update_node`, `remove_node` (remove arestas conectadas), `add_edge`, `update_edge`, `remove_edge`, `add_group`, `update_group`, `remove_group` (desagrupa os nós), `set_direction`, `set_layout`, `pin_node`, `unpin_node`.

**Entradas alternativas.** `mermaid`: subconjunto de `flowchart` (nós, formas básicas, arestas com rótulo, `subgraph` como grupo, direção). O parser é próprio e pequeno, porque a biblioteca Mermaid completa é pesada demais para esse uso. Modelos conhecem Mermaid muito bem, o que reduz erros na criação.

**Renderização.** SVG com paleta do tema, marcadores de seta, grupos com rótulo superior ou lateral, zoom e pan.

**Editor (fase 1).** React Flow: arrastar nós (fixa posição), criar arestas, editar rótulos, agrupar e desagrupar. Cada interação gera operações do tipo.

**Exportação.** `svg` (estático, sem scripts), `png` (canvas no navegador ou headless no servidor), `pdf`, e inserção como imagem nos exportadores de documento e slides.

### 11.5 App: HTML e React isolados (`app`), fase 2

**Objetivo.** Componentes customizados que não cabem nos tipos estruturados: calculadoras, simuladores, visualizações interativas, mini ferramentas internas.

**Modelo de conteúdo.**

| Campo | Regra |
|---|---|
| `files` | Mapa `caminho -> código` (tsx, ts, css, json). Tamanho total limitado. |
| `entry` | Arquivo de entrada com export default de um componente React ou documento HTML. |
| `dependencies` | Apenas pacotes da lista permitida pela aplicação, com versões fixadas pelo host. |
| `capabilities` | Capacidades solicitadas (`storage`, `fetch` via proxy do host, `downloads`, `callTool`). Nenhuma por padrão. |
| `data` | JSON inicial passado ao componente. |

**Operações.** `write_file`, `edit_file` (substituição por âncora única, no estilo `str_replace`), `delete_file`, `set_entry`, `set_data`, `set_capabilities`.

**Execução.**

- Compilação no servidor com esbuild, resolvendo apenas imports da lista permitida; erros de compilação retornam ao agente com arquivo, linha e coluna.
- Execução em iframe com `sandbox="allow-scripts"` sem `allow-same-origin`, servido de origem separada por artefato.
- CSP restritiva: `default-src 'none'`, scripts apenas do bundle, `connect-src 'none'` exceto quando `fetch` via proxy for concedido.
- Ponte `postMessage` com JSON-RPC compatível com MCP Apps: o componente pede capacidades, o host aplica a política e solicita aprovação humana quando configurado.
- Captura de erros de runtime enviada ao host e devolvida ao agente na próxima leitura.

**Exportação.** `html` autocontido (bundle embutido), `png` (captura headless), `zip` com o código-fonte.

## 12. Exportação

### 12.1 Orquestração

`@artkit/node` expõe `exportArtifact(artifact, format, options)`, que:

1. Resolve o exportador registrado para o tipo e o formato.
2. Migra o conteúdo, resolve tema, locale e assets.
3. Executa com tempo limite e `AbortSignal`.
4. Grava o resultado no `AssetStore` (opcional) e retorna bytes ou referência.

Exportadores com `runtime: 'any'` também rodam no navegador para download direto sem passar pelo servidor.

### 12.2 Matriz de formatos

| Tipo | md | html | docx | xlsx | csv | pptx | svg | png | pdf | zip |
|---|---|---|---|---|---|---|---|---|---|---|
| Documento | sim | sim | sim |  |  |  |  |  | sim |  |
| Planilha |  | sim |  | sim | sim |  |  |  | sim |  |
| Slides |  |  |  |  |  | sim |  | sim | sim |  |
| Diagrama |  |  |  |  |  |  | sim | sim | sim |  |
| App (fase 2) |  | sim |  |  |  |  |  | sim |  | sim |

### 12.3 Render headless

- PNG e PDF de documento, planilha e slides são produzidos renderizando o próprio renderer React em Chromium headless (Playwright), garantindo que o arquivo seja idêntico ao que o usuário vê.
- O módulo mantém um pool de navegadores com limite de concorrência, tempo limite por página e bloqueio total de rede durante o render (assets são injetados como data URLs).

### 12.4 Fidelidade

- Cada exportador tem uma lista pública do que é e do que não é suportado no formato de destino.
- Elementos sem equivalente nativo são convertidos com degradação controlada e registrada em `warnings` do resultado (por exemplo, callout vira tabela de uma célula sombreada no docx).

## 13. Camada React

### 13.1 Componentes

| Componente | Função |
|---|---|
| `<ArtifactProvider>` | Recebe registro, tema, locale, cliente de dados e carregadores preguiçosos de renderers, editores e exportadores. |
| `<ArtifactView>` | Renderiza qualquer artefato pelo tipo, em modo leitura. |
| `<ArtifactEditor>` | Renderiza o editor do tipo quando existir; caso contrário, cai para `ArtifactView`. |
| `<ArtifactPanel>` | Painel lateral no estilo de assistentes de IA: abas Visualização, Código (JSON) e Histórico; seletor de versões; exportação; status. |
| `<ArtifactCard>` | Cartão compacto para exibir dentro da mensagem do chat, com título, tipo, versão e ação de abrir. |
| `<ArtifactApproval>` | Exibe o diff da versão pendente com ações aprovar e rejeitar (com motivo). |
| `<ArtifactVersionDiff>` | Comparação lado a lado ou destacada entre duas versões. |

### 13.2 Hooks

| Hook | Função |
|---|---|
| `useArtifact(id, { version })` | Carrega um artefato pelo cliente de dados, com cache e revalidação por versão. |
| `useArtifactHistory(id)` | Lista versões e permite restaurar. |
| `useApplyOperations(id)` | Envia operações do editor com `baseVersion` e trata conflito. |
| `useArtifactExport(id)` | Exporta no navegador quando possível ou pelo servidor. |

O hook `useArtifacts(messages)`, que deriva artefatos das mensagens do chat, fica no adaptador do AI SDK (seção 14.4).

### 13.3 Cliente de dados

A camada React não acessa o store diretamente. Ela usa uma interface `ArtifactClient` (get, history, apply, export), com implementação HTTP de referência compatível com rotas expostas por `@artkit/node`. Isso mantém credenciais e autorização no servidor.

### 13.4 Streaming de prévia

- Durante a geração, o renderer recebe o conteúdo parcial convertido por `parsePartial` do tipo, que descarta itens incompletos no final (bloco sem fechamento, linha de tabela pela metade).
- A prévia é marcada visualmente como provisória e substituída pela versão confirmada quando o commit chega.

### 13.5 Estilo e tema

- CSS próprio com prefixo e variáveis (`--ak-color-accent`), sem dependência de framework de estilo.
- Tema claro e escuro derivados do tema do artefato e do tema da aplicação.
- Componentes aceitam `className` e `slots` de customização sem exigir fork.

### 13.6 Requisitos comuns dos editores

Os quatro editores da versão 1 (documento, planilha, slides e diagrama) seguem as mesmas regras:

- **Edição por operações.** Toda interação vira operações do tipo, enviadas por `useApplyOperations` com `baseVersion`. Nenhum editor grava conteúdo inteiro.
- **Agrupamento.** Interações próximas no tempo são agrupadas em um único lote (janela configurável), para não gerar uma versão por tecla. Gestos contínuos geram uma operação ao final.
- **Aplicação otimista.** A operação é aplicada localmente pelo mesmo `apply` do tipo e confirmada pelo servidor. Em rejeição, o estado local volta à última versão confirmada e o erro aparece no painel.
- **Desfazer e refazer** locais por pilha de lotes do próprio usuário, convertidos em novas versões ao confirmar (seção 8.5).
- **Edição concorrente com o agente.** Se o agente gravar uma versão durante a edição, o editor tenta o rebase automático; havendo conflito, mostra o diff e oferece manter a versão do agente ou reaplicar a edição local.
- **Bloqueio.** Com o artefato bloqueado pelo agente, o editor fica em modo leitura e mostra a prévia em streaming.
- **Permissões.** Modo leitura, comentário (fase 3) e edição definidos pela aplicação.
- **Acessibilidade.** Operação completa por teclado, foco visível e anúncios para leitores de tela nas ações principais.
- **Carregamento sob demanda.** Cada editor fica no subcaminho `/edit` do tipo e só é carregado quando o usuário entra em modo de edição.

## 14. Integração com agentes

### 14.1 Toolkit neutro

`@artkit/agent` gera, a partir do registro, definições de ferramenta independentes de harness:

```ts
const toolkit = createArtifactToolkit({
  registry,
  store,
  assets,
  authorize, // (ação, artefato, ator) => boolean | Promise<boolean>
  logger,
  approval: { submit: 'always', apply: 'never' },
  locale: 'pt-BR',
});

toolkit.tools; // definições neutras: nome, descrição, JSON Schema, handler
toolkit.instructions(); // texto de sistema com regras e exemplos dos tipos habilitados
```

### 14.2 Ferramentas

| Ferramenta | Entrada | Saída |
|---|---|---|
| `artifact_create` | `kind`, `title`, e `content` ou `input` (`{ format: 'markdown' \| 'mermaid' \| 'csv' \| 'table', source }`) | `id`, `version`, ids gerados, lint |
| `artifact_read` | `id`, `mode` (`outline`, `full`, `range`), `range`, `maxTokens`, `cursor` | projeção, `version`, `cursor` |
| `artifact_apply` | `id`, `baseVersion`, `operations[]` | nova `version`, ids gerados, diff, lint |
| `artifact_export` | `id`, `format` | referência do arquivo e avisos de fidelidade |
| `artifact_list` | filtros (tipo, título, status) | lista paginada com id, título, tipo, versão |
| `artifact_submit` | `id`, `message` | status `pending_approval` ou resultado da aprovação |

Diretrizes de desenho das ferramentas:

- Descrições curtas e imperativas; regras de cada tipo ficam em `instructions()`, não duplicadas em cada ferramenta.
- O esquema de `operations` é a união discriminada de todos os tipos habilitados, com variante por tipo selecionada pelo `kind` do artefato no handler; para provedores com limite de tamanho de esquema, o toolkit gera uma ferramenta `artifact_apply_<kind>` por tipo.
- Para artefatos grandes, as instruções orientam criar o esqueleto e completar com lotes de `apply`, o que dá progresso visível e reduz chamadas gigantes.
- Toda resposta de sucesso inclui a nova `version`, para que o modelo sempre tenha a `baseVersion` correta.

### 14.3 Instruções e skills

- `instructions({ kinds, detail: 'compact' | 'full' })` gera o bloco de sistema com: quando usar cada tipo, regras, ids, tokens de tema e um exemplo mínimo por tipo.
- O mesmo material, mais detalhado, é publicado como skills de orientação (seção 14.7), carregadas sob demanda para não ocupar o contexto com tipos não usados.
- Instruções são versionadas junto com o `schemaVersion` do tipo e cobertas pelos evals.

### 14.4 Adaptador AI SDK 7

`@artkit/ai-sdk` converte o toolkit neutro em ferramentas do AI SDK 7 e cuida da integração de interface. Os nomes de API abaixo seguem o AI SDK 7 e serão confirmados contra a versão estável em uso no início do desenvolvimento.

```ts
import { ToolLoopAgent } from 'ai';
import { artifactTools, artifactInstructions } from '@artkit/ai-sdk';

const agent = new ToolLoopAgent({
  model,
  instructions: [baseInstructions, artifactInstructions(toolkit)].join('\n\n'),
  tools: artifactTools(toolkit),
  contextSchema: artifactContextSchema, // workspace, usuário, emissor de eventos de UI
});
```

Responsabilidades do adaptador:

- **Contexto.** Store, usuário, workspace e emissor de data parts entram pelo contexto de ferramenta (`contextSchema` e `toolsContext`), nunca pelos argumentos do modelo. O handler ignora qualquer id de usuário ou workspace vindo do modelo.
- **Aprovação.** `artifact_submit` e, opcionalmente, `artifact_apply` em artefatos publicados usam `toolApproval`. Para aprovações longas, o adaptador documenta o uso com `WorkflowAgent`, mantendo a execução pausada de forma durável.
- **Data parts.** Cada commit emite `data-artifact` com `id` estável e campos `{ id, kind, title, version, status }`, atualizado no lugar pelo mesmo id. As mensagens carregam referência, não o conteúdo inteiro, o que mantém o histórico do chat pequeno.
- **Prévia.** Enquanto a ferramenta está em `input-streaming`, o cliente lê o input parcial e alimenta `parsePartial`.
- **Hook de cliente.** `useArtifacts(messages)` deriva, a partir dos parts de `useChat`, o mapa de artefatos com última versão confirmada, prévia em andamento e estado de aprovação (`approval-requested`, aprovado, rejeitado), e expõe ações de aprovar e rejeitar ligadas ao protocolo do AI SDK.
- **Harness.** Como o `HarnessAgent` emite o mesmo stream de UI, o hook funciona com Pi e outros harnesses suportados; esses adaptadores ficam marcados como experimentais enquanto o AI SDK os mantiver assim.

### 14.5 Servidor MCP

`@artkit/mcp` expõe:

- As mesmas ferramentas do toolkit, com as mesmas descrições e esquemas.
- Recursos `artifact://{id}` (projeção `outline`) e `artifact://{id}/v/{version}`.
- Na fase 2, recurso de interface compatível com MCP Apps para exibir o renderer dentro de clientes MCP que suportem.
- Transportes stdio e HTTP streamable; autenticação delegada à aplicação hospedeira.

### 14.6 Compatibilidade de esquema entre provedores

- Esquemas são gerados a partir do `zod` com `toJSONSchema`.
- O toolkit oferece perfis de compatibilidade: `default`, `strict` (todas as propriedades obrigatórias com `null` para opcionais e `additionalProperties: false`, exigido por modos estritos de alguns provedores) e `compact` (remove descrições longas e exemplos).
- Os evals rodam com cada perfil nos modelos suportados.

### 14.7 Skills de orientação para agentes

O pacote `@artkit/skills` (fase 1) publica skills no formato Agent Skills: uma pasta com `SKILL.md` (metadados `name` e `description` e corpo curto) e arquivos de referência carregados apenas quando necessários. Há duas skills com públicos diferentes.

#### Skill `artkit-artefatos` (uso em tempo de execução)

Orienta o agente que cria, lê e edita artefatos pelas ferramentas da seção 14.2.

```
artkit-artefatos/
  SKILL.md               escolha do tipo, fluxo de trabalho, regras gerais e recuperação de erros
  references/
    document.md          modelo, operações, entrada Markdown, checklist e anti-padrões
    sheet.md             modelo, fórmulas suportadas, fill_range, checklist e anti-padrões
    slides.md            layouts e slots, elementos livres, gráficos, checklist e anti-padrões
    diagram.md           nós, grupos, entrada Mermaid, checklist e anti-padrões
    themes.md            tokens de cor e tipografia
    errors.md            cada código de erro com a ação de correção esperada
  examples/              artefatos completos de referência (proposta, estimativa, deck, arquitetura)
```

Conteúdo do `SKILL.md`:

- **Escolha do tipo:** tabela de decisão (texto para ler ou assinar vira documento; cálculo e totais viram planilha; apresentação para reunião vira slides; estrutura e fluxos viram diagrama) e quando combinar tipos.
- **Fluxo padrão:** ler o `outline` antes de editar algo existente; criar o esqueleto; completar em lotes de `apply`; tratar avisos de lint; exportar ou submeter para aprovação.
- **Regras gerais:** ids semânticos e estáveis; sempre usar a `version` devolvida como próxima `baseVersion`; cores por token do tema; nunca colar HTML nos tipos estruturados; preferir operações pequenas a `replace_content`.
- **Recuperação:** o que fazer em `INVALID_OPERATION`, `OPERATION_FAILED`, `VERSION_CONFLICT` e `LIMIT_EXCEEDED`, com o limite de tentativas antes de pedir ajuda ao usuário.

Checklists de qualidade nas referências, por tipo:

| Tipo | Exemplos de orientação |
|---|---|
| Documento | Hierarquia de títulos sem saltos; tabelas com cabeçalho e linha de total; callouts para premissas e riscos; Markdown na criação e operações por id na edição. |
| Planilha | Totais sempre por fórmula; valores de entrada separados dos cálculos; aba de premissas; formatos nomeados em vez de texto formatado; `fill_range` para séries. |
| Slides | Layouts antes de posição livre; uma ideia por slide; título como afirmação; limite de marcadores por slide; números destacados com `big-number`; notas do apresentador para o detalhe. |
| Diagrama | Grupos como camadas ou raias; rótulos curtos; uma direção dominante; Mermaid para criar e operações para ajustar. |

#### Skill `artkit-integracao` (desenvolvimento)

Orienta agentes de código (Claude Code, Cursor e similares) a integrar a biblioteca numa aplicação:

- Instalar os pacotes com o gerenciador já usado no projeto e escolher os subcaminhos necessários.
- Montar o registro de tipos, temas, store, assets e o hook de autorização.
- Plugar o toolkit no `ToolLoopAgent` (contexto, aprovação, data parts) e o painel React com `useArtifacts`.
- Expor o servidor MCP.
- Criar um tipo próprio com `defineKind` e validá-lo com a suíte de conformidade.
- Armadilhas conhecidas: aceitar id de workspace vindo do modelo, gravar conteúdo sem passar pelo pipeline, carregar editores fora do subcaminho `/edit`.

#### Geração, sincronismo e distribuição

- As referências por tipo são geradas a partir de `KindInstructions`, dos esquemas e dos exemplos do registro, por um script do build. O texto autoral fica em arquivos-fonte versionados junto ao tipo; a parte técnica (campos, operações, limites) nunca é escrita à mão.
- Cada skill declara a faixa de versões da biblioteca e de `schemaVersion` que cobre. O CI valida todos os exemplos e trechos de operação da skill contra os esquemas e falha em divergência.
- Distribuição: pasta pronta para instalação no repositório e no pacote npm; `toolkit.skills()` devolve os arquivos para a aplicação gravar onde o harness espera.
- Harnesses com suporte nativo a skills (por exemplo, `HarnessAgent` com Pi ou Claude Code) carregam a pasta diretamente.
- Para o `ToolLoopAgent` e outros sem suporte nativo, o toolkit oferece a ferramenta `artifact_guide({ topic })`, que devolve o `SKILL.md` ou uma referência sob demanda, reproduzindo a divulgação progressiva por ferramenta.
- No MCP, as skills são expostas como prompts e como recursos `artkit://guide/{topic}`.
- A aplicação pode estender a skill com regras próprias (identidade visual, padrões de proposta da empresa) por arquivos sobrepostos, sem editar a skill base. Pacotes comerciais de templates trazem extensões próprias.
- Os evals medem cada tipo com e sem a skill; o ganho medido é critério de saída.

## 15. Armazenamento e ciclo de vida

### 15.1 Contratos

```ts
interface ArtifactStore {
  get(scope: Scope, id: string, opts?: { version?: number }): Promise<StoredArtifact | null>;
  create(scope: Scope, input: NewArtifact): Promise<StoredArtifact>;
  commit(scope: Scope, id: string, change: Commit): Promise<StoredArtifact>; // lança VERSION_CONFLICT
  history(scope: Scope, id: string, page: PageRequest): Promise<Page<VersionEntry>>;
  list(scope: Scope, filter: ArtifactFilter, page: PageRequest): Promise<Page<ArtifactSummary>>;
  setStatus(scope: Scope, id: string, status: ArtifactStatus, actor: Actor): Promise<StoredArtifact>;
  lock(scope: Scope, id: string, actor: Actor, ttlMs: number): Promise<Lock>;
  unlock(scope: Scope, lock: Lock): Promise<void>;
}

interface AssetStore {
  put(scope: Scope, bytes: Uint8Array, meta: AssetMeta): Promise<AssetRef>;
  get(scope: Scope, ref: AssetRef): Promise<Uint8Array>;
  url(scope: Scope, ref: AssetRef, ttlSeconds: number): Promise<string>;
}
```

- `Scope` carrega workspace e ator. Toda implementação filtra por escopo; ids sozinhos nunca dão acesso.
- O núcleo fornece uma suíte de testes de contrato que qualquer adaptador de store precisa passar.

### 15.2 Adaptadores

| Adaptador | Fase | Uso |
|---|---|---|
| Memória | 1 | Testes, playground e protótipos. |
| Sistema de arquivos | 1 | Ferramentas locais, CLI e agentes de desenvolvimento. |
| Postgres de referência | 1 | Exemplo de produção com tabelas de artefatos, versões e assets, publicado como exemplo e não como pacote obrigatório. |
| Serviço gerenciado | 3 | Oferta comercial com versões, aprovação e exportação hospedadas. |

### 15.3 Ciclo de vida

```
draft ──submit──▶ pending_approval ──aprovar──▶ published ──arquivar──▶ archived
  ▲                     │                          │
  └──────rejeitar───────┘                          └──nova edição──▶ draft (nova versão)
```

- Edição de artefato `published` cria nova versão em `draft`, preservando a versão publicada como referência até nova aprovação.
- Políticas configuráveis por aplicação: exigir aprovação para publicar, para exportar ou para qualquer edição de artefato publicado.

### 15.4 Eventos

O núcleo emite eventos tipados (`artifact.created`, `artifact.committed`, `artifact.conflict`, `artifact.status_changed`, `artifact.exported`, `artifact.lint`) por um barramento injetável, para auditoria, notificações e integração com filas.

## 16. Segurança

- **Validação estrita** de toda entrada vinda do modelo e do usuário, com limites de tamanho e profundidade.
- **Sem HTML bruto** nos tipos estruturados. Renderers usam apenas elementos React gerados a partir do esquema; não há `dangerouslySetInnerHTML` fora do tipo `app`.
- **Links** restritos a protocolos permitidos; links externos renderizados com `rel="noopener noreferrer"`.
- **SVG** de assets sanitizado (sem scripts, eventos ou referências externas). SVG exportado de diagramas é gerado pela própria biblioteca.
- **Fórmulas** sem funções de efeito externo; exportação xlsx sem macros; `csv` com proteção contra injeção de fórmula (prefixo em valores iniciados por `=`, `+`, `-`, `@` quando a origem é texto).
- **Isolamento de escopo** em stores e assets, com hook de autorização obrigatório no toolkit.
- **Injeção de prompt.** O conteúdo de artefatos é tratado como dado: a projeção é delimitada e as instruções orientam o modelo a não seguir instruções contidas em artefatos.
- **Tipo `app` (fase 2).** Iframe sem mesma origem, origem separada, CSP restritiva, capacidades negadas por padrão, aprovação humana para capacidades sensíveis, lista permitida de dependências e limites de tempo de compilação e tamanho de bundle.
- **Render headless** sem acesso à rede, com tempo limite e processos isolados.
- **Política de segurança** do projeto open source com canal privado de reporte e prazos de correção.

## 17. Observabilidade

- Interface `Logger` injetável com níveis e campos estruturados; implementação padrão silenciosa.
- Campos padronizados: `artifactId`, `kind`, `version`, `operationCount`, `durationMs`, `code` de erro, `actorType`.
- Nunca registrar conteúdo de artefatos, textos de células, prompts ou dados pessoais; apenas metadados e contagens.
- Ganchos de métricas para duração de `apply`, exportação e render, taxa de conflito e taxa de rejeição por código.
- Rastreamento opcional compatível com OpenTelemetry via ganchos, sem dependência obrigatória.

## 18. Internacionalização e acessibilidade

### 18.1 Internacionalização

- Formatação numérica, monetária e de datas via `Intl` conforme `locale` do artefato.
- Mensagens de erro e textos de interface em pt-BR e en na versão 1, com catálogo extensível.
- Instruções do modelo em inglês por padrão (melhor desempenho médio entre modelos), com suporte a conteúdo do artefato em qualquer idioma; os evals medem as duas combinações.

### 18.2 Acessibilidade

- Renderers com semântica correta (títulos, tabelas com cabeçalho, listas, textos alternativos).
- Navegação por teclado no painel, nos seletores de versão e nos editores.
- Lint de acessibilidade por tipo (contraste, texto alternativo, hierarquia de títulos).
- Exportadores preservam estrutura acessível nos formatos que suportam (estilos de título no docx, texto alternativo em imagens do pptx).

## 19. Desempenho

- Orçamento de tamanho por pacote verificado no CI (núcleo e subcaminhos `.` dos tipos pequenos o bastante para edge e navegador; renderers e editores carregados sob demanda).
- `apply` com custo proporcional ao tamanho do lote mais uma revalidação completa; revalidação incremental fica como otimização posterior, guiada por medição.
- Grade da planilha e listas longas virtualizadas.
- Exportação e render headless fora da thread principal da aplicação (worker ou processo dedicado).
- Benchmarks reproduzíveis para artefatos no limite de tamanho de cada tipo, executados a cada release.

## 20. Extensibilidade

- **Tipos de terceiros** com `defineKind`, usando o mesmo contrato e a mesma suíte de testes de conformidade dos tipos nativos.
- **Exportadores, renderers e editores** registráveis por tipo e formato, permitindo substituir a implementação padrão.
- **Layouts de slide e temas** registráveis pela aplicação.
- **Motor de fórmulas e motor de layout de diagrama** plugáveis por interface.
- **Entradas alternativas** adicionais por tipo (por exemplo, PlantUML para diagrama) sem alterar o núcleo.
- Gerador de esqueleto de tipo na CLI (fase 2).

## 21. Qualidade: testes e evals

### 21.1 Testes

| Camada | Estratégia |
|---|---|
| Esquemas e operações | Testes unitários por operação, incluindo casos de rejeição com código e caminho esperados. |
| Invariantes | Testes de propriedade: sequências aleatórias de operações válidas sempre produzem conteúdo válido, e replay produz o mesmo resultado. |
| Migrações | Fixtures de cada `schemaVersion` publicada migrando até a atual. |
| Exportadores | Arquivos de referência com verificação estrutural (relendo o arquivo com a própria biblioteca do formato) e conversão de fumaça em LibreOffice headless; na planilha, conferência de que o recálculo do LibreOffice bate com o valor em cache. |
| Renderers | Regressão visual com Playwright sobre o catálogo de exemplos. |
| Editores | Testes de interação nos quatro editores garantindo que cada gesto gera as operações esperadas, preserva ids, agrupa lotes e trata conflito com o agente. |
| Motor de fórmulas | Mesmo conjunto de casos executado no navegador e no Node, exigindo resultados idênticos. |
| Skills | Validação dos exemplos e trechos contra os esquemas; verificação de que a faixa de versões declarada corresponde ao pacote. |
| Stores | Suíte de contrato compartilhada para todos os adaptadores. |
| Agente | Testes do toolkit com modelo simulado e testes do adaptador AI SDK com stream simulado. |
| Sandbox (fase 2) | Testes de fuga: acesso a cookies, armazenamento do host, rede e navegação do topo devem falhar. |

### 21.2 Evals

Os evals provam que o padrão é fácil para IA e são critério de saída de cada release.

- **Conjunto de tarefas por tipo:** criar a partir de um briefing, editar um ponto específico, corrigir após erro, reorganizar estrutura, trabalhar em artefato grande com leitura paginada, e tarefas que cruzam tipos (planilha de estimativa e proposta coerentes).
- **Métricas:** taxa de artefato válido na primeira tentativa; taxa de sucesso em até duas correções; número de operações por tarefa; tokens de entrada e saída; avisos de lint por artefato; nota de qualidade por rubrica em amostra revisada por pessoas.
- **Matriz:** pelo menos dois provedores de modelo, os perfis de esquema `default` e `strict`, e execução com e sem a skill `artkit-artefatos`.
- **Metas iniciais a calibrar no primeiro ciclo:** validade de pelo menos 90% em até duas tentativas por tipo, sem regressão entre releases.
- Resultados publicados no site de documentação a cada release.

## 22. Documentação e experiência de desenvolvimento

- **Especificação pública do padrão de dados**, versionada, com JSON Schema por tipo e por versão em URLs estáveis.
- **Site de documentação** com guias de início rápido (AI SDK, MCP, uso apenas no servidor), guia por tipo, referência de API gerada a partir dos tipos TypeScript, catálogo de erros e matriz de fidelidade de exportação.
- **Playground** público com os exemplos, edição, aplicação de cenários de operações, visão do agente e exportação (evolução do playground da POC).
- **Exemplos executáveis:** chat Next.js com AI SDK 7 e painel de artefatos; script Node de geração e exportação; servidor MCP para clientes desktop.
- **Changelog** e guia de migração por versão maior.

## 23. Open core, licença e governança

### 23.1 Recorte

| Aberto (Apache-2.0) | Comercial |
|---|---|
| `core`, todos os tipos da versão 1 com seus editores e o tipo `app`, `react`, `node`, `agent`, `ai-sdk`, `mcp`, `skills`, `sandbox`, `cli`, `evals` | Colaboração em tempo real (servidor e vínculos Yjs), importação fiel de docx, xlsx e pptx, pacotes de templates e identidade visual, serviço gerenciado de versões, aprovação e exportação, suporte com SLA |

Regra do recorte: tudo que um desenvolvedor precisa para gerar, editar, revisar e exportar artefatos com qualidade fica aberto. O comercial cobre operação em escala, colaboração e conveniência empresarial.

### 23.2 Governança

- Contrato de cessão para contribuidores (CLA) para preservar a opção de licença dupla no futuro; alternativa mais leve é o DCO, que não permite relicenciar.
- Política de marca para o nome do projeto.
- Processo de RFC para qualquer mudança no padrão de dados, com período público de comentários.
- Guia de contribuição, código de conduta e política de segurança no repositório.
- Releases com versionamento semântico, changesets e publicação automatizada no npm com proveniência.

## 24. Catálogo de outros tipos de artefato

Tipos comuns em produtos com agentes de IA, avaliados para o roteiro:

| Tipo | Descrição | Como se encaixa | Fase sugerida |
|---|---|---|---|
| `chart` | Gráfico isolado (barras, linhas, pizza, dispersão, área) | Tipo próprio leve, reutilizado por slides, documento e dashboard; exporta svg, png e dados em csv | 2 |
| `dataset` | Tabela de dados tipada, sem fórmulas, para resultados de consultas | Tipo próprio com colunas tipadas, filtros e ordenação na visualização; exporta csv e xlsx | 2 |
| `code` | Um ou mais arquivos de código com linguagem | Tipo próprio com operações no estilo `str_replace`; exporta zip | 2 |
| `image` | SVG gerado ou imagem anexada com anotações | Tipo próprio com SVG sanitizado | 2 |
| `mindmap` | Mapa mental | Variante do diagrama com layout radial | 2 |
| `email` | Rascunho de mensagem (assunto, destinatários, corpo) | Tipo próprio pequeno, integrável a conectores de e-mail | 2 |
| `dashboard` | Composição de KPIs, gráficos e tabelas | Tipo composto que referencia `chart` e `dataset` | 3 |
| `form` | Formulário com campos, validações e lógica condicional | Tipo próprio com renderer interativo e exportação de respostas | 3 |
| `tasks` | Lista de tarefas ou quadro kanban com responsáveis e datas | Tipo próprio com visões lista e quadro | 3 |
| `timeline` | Cronograma ou Gantt | Tipo próprio com dependências; exporta xlsx e pptx | 3 |
| `whiteboard` | Quadro livre com notas e formas | Implementação própria ou baseada em biblioteca MIT, evitando tldraw por licença | 3 |
| `quiz` | Questionário ou flashcards | Tipo próprio simples | 3 |
| `map` | Mapa com camadas GeoJSON | Tipo próprio com renderer de mapa | 3 |

Na fase 3 entra também o recurso de **vínculos entre artefatos**: um gráfico de slide ou documento ligado a um intervalo de planilha, atualizado quando a planilha muda.

## 25. Fases e entregáveis

### 25.1 Fase 1: núcleo aberto e quatro tipos

**Entregáveis.**

- Especificação pública do padrão de dados (envelope, contrato de tipo, operações, projeção, erros) e JSON Schemas publicados.
- `@artkit/core` completo: registro, motor de operações com rebase e idempotência, versionamento, migrações, diff, lint, projeção com orçamento, catálogo de erros, contratos de store, assets e eventos.
- Tipos `document`, `sheet`, `slides` e `diagram` estáveis, com operações, projeção, lint, diff, `parsePartial`, instruções e entradas alternativas (Markdown, CSV e tabela, Mermaid).
- Recálculo de fórmulas por meio da interface `FormulaEngine` e de um adaptador de referência que roda no servidor (autoridade) e no navegador (resposta imediata no editor).
- Exportadores docx, xlsx, csv, pptx, svg, png, pdf, md e html conforme a matriz da seção 12.2, com render headless.
- `@artkit/react`: provider, view, painel, cartão, aprovação, diff de versões, hooks e prévia em streaming.
- Editores visuais dos quatro tipos: documento (TipTap), planilha (Glide Data Grid), slides (`react-moveable`) e diagrama (React Flow), seguindo os requisitos comuns da seção 13.6.
- `@artkit/node`: stores de memória e sistema de arquivos, store de assets, orquestração de exportação e exemplo Postgres.
- `@artkit/agent`, `@artkit/ai-sdk` e `@artkit/mcp`.
- `@artkit/skills`: skills `artkit-artefatos` e `artkit-integracao`, ferramenta `artifact_guide`, geração automática das referências e validação no CI.
- Suíte de evals com relatório por tipo e por modelo.
- Site de documentação, playground público e exemplos executáveis.
- CI com typecheck, lint, testes, orçamento de tamanho, verificação de licenças de dependências e publicação automatizada.

**Critérios de saída.**

- Metas de evals atingidas em todos os quatro tipos e nos dois provedores de referência, com ganho mensurável da skill em relação à execução sem ela.
- Os quatro editores aprovados em teste de uso com pessoas, cobrindo edição concorrente com o agente.
- Exportações abertas sem erro no Microsoft Office, no LibreOffice e no Google (Docs, Sheets e Slides), com a matriz de fidelidade documentada.
- Recálculo das fórmulas exportadas conferido no LibreOffice e no Excel para os exemplos oficiais.
- Suíte de contrato aprovada pelos stores de referência.
- Exemplo de chat com AI SDK 7 funcionando de ponta a ponta: criação com prévia em streaming, edição incremental, edição humana no editor, conflito resolvido, aprovação e exportação.

### 25.2 Fase 2: tipos interativos

**Entregáveis.**

- Tipo `app` e pacote `sandbox`, com compilação, ponte compatível com MCP Apps, capacidades e testes de fuga.
- Extensão das skills para os novos tipos.
- Tipos `chart`, `dataset`, `code`, `image`, `email` e variante `mindmap` do diagrama.
- `@artkit/cli` (validar, exportar, renderizar, inspecionar, gerar esqueleto de tipo).
- Adaptador de layout elkjs opcional e recurso de interface MCP Apps no servidor MCP.
- Promoção dos adaptadores de harness para estáveis, conforme a estabilidade no AI SDK.

**Critérios de saída.** Metas de evals estendidas aos novos tipos; auditoria de segurança externa do sandbox concluída sem achados críticos abertos.

### 25.3 Fase 3: módulos comerciais e tipos compostos

**Entregáveis.**

- Colaboração em tempo real com Yjs (servidor, vínculos com os editores, presença e comentários).
- Importação fiel de docx, xlsx e pptx para o padrão de dados.
- Pacotes de templates e identidade visual.
- Serviço gerenciado de versões, aprovação e exportação.
- Tipos `dashboard`, `form`, `tasks`, `timeline`, `whiteboard`, `quiz` e `map`, e vínculos entre artefatos.

## 26. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Mudanças nas APIs do AI SDK 7, especialmente nos recursos experimentais | Toolkit neutro isolado do adaptador; adaptador fino com testes de contrato contra a versão fixada; recursos experimentais marcados como tal. |
| Fidelidade das exportações Office (ajuste de texto no pptx, estilos no docx) | Lint de estouro antes de exportar; matriz de fidelidade pública; conferência em três suítes no CI de release. |
| Cobertura limitada do motor de fórmulas | Subconjunto de funções explícito e validado na entrada; interface plugável para trocar o motor. |
| Crescimento descontrolado de escopo com muitos tipos | Contrato de tipo único, critérios de saída por fase e catálogo priorizado. |
| Fase 1 maior com quatro editores, sobretudo planilha e slides | Requisitos comuns de editor implementados uma vez (seção 13.6); conjunto de funcionalidades de cada editor fechado nesta especificação; recursos fora da lista vão para o roteiro. |
| Divergência de cálculo entre navegador e servidor | Mesmo adaptador de motor nos dois ambientes, suíte de casos compartilhada e servidor como autoridade. |
| Skills desatualizadas em relação aos esquemas | Referências geradas a partir do registro e validação dos exemplos no CI. |
| Licenças incompatíveis em dependências transitivas | Verificação automática de licenças no CI e lista de vetos. |
| Fuga do sandbox no tipo `app` | Isolamento por origem, CSP, capacidades negadas por padrão, testes de fuga e auditoria externa. |
| Variação de desempenho entre modelos e provedores | Evals por provedor e perfis de esquema; instruções compactas e exemplos mínimos. |
| Custo de manutenção do projeto aberto | Governança clara, RFC para o padrão, automação de release e núcleo pequeno. |
| Disputa de nome ou marca | Verificação no npm, no INPI e em registros internacionais antes da publicação. |

## 27. Decisões em aberto

| Decisão | Alternativas | Recomendação atual |
|---|---|---|
| Nome do projeto e escopo npm | A) `artkit`; B) outro nome após pesquisa de marca | Pesquisa de marca antes do primeiro commit público. |
| Markdown como tipo | A) Representação do documento (entrada e exportação); B) Tipo `markdown` separado de texto puro | A, por manter um único modelo de dados e edição por id. |
| Motor de fórmulas | A) IronCalc (WASM, MIT ou Apache); B) fast-formula-parser (MIT); C) Implementação própria do subconjunto | Spike comparando A e B em cobertura, tamanho de bundle e desempenho no navegador e no Node, agora decisivo por causa do editor de planilha na fase 1. |
| Caminho do PDF | A) Render headless do renderer React; B) Conversão do docx ou pptx via LibreOffice | A, por fidelidade com a visualização e dependência menor. |
| Layout de diagramas grandes | A) dagre e layout em bandas próprios; B) elkjs como padrão | A como padrão; B opcional após análise jurídica da EPL-2.0. |
| Contribuições | A) CLA; B) DCO | A, se a licença dupla futura for estratégica. |
| Momento do tipo `app` | A) Fase 2, como planejado; B) Antecipar para a fase 1 | A, pelo peso de segurança e de auditoria. |
| Publicação | A) Pacotes com escopo; B) Pacotes com escopo mais um pacote agregador | B, para facilitar a adoção inicial. |
