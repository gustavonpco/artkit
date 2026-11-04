/** Workia artifact shapes (read-only view of what the migration consumes). */

export interface WorkiaDocumento {
  frontmatter: {
    tipo: 'documento';
    schemaVersion: number;
    titulo: string;
    subtitulo?: string;
    campos?: Record<string, string>;
  };
  body: string;
}

export interface WorkiaPlanilha {
  tipo: 'planilha';
  schemaVersion: number;
  titulo: string;
  moeda?: string;
  notas?: string;
  parametros: { id: string; rotulo: string; tipo: string; valor: number }[];
  colunas: { id: string; rotulo: string; tipo: string; formula?: string }[];
  linhas: { id: string; grupo?: string; celulas: Record<string, string | number> }[];
  totais: {
    id: string;
    rotulo: string;
    op: string;
    coluna?: string;
    agruparPor?: string;
    formula?: string;
    formato?: string;
  }[];
}

export interface WorkiaBlock {
  id: string;
  tipo: 'texto' | 'indicador' | 'etapa' | 'cartao' | 'imagem';
  markdown?: string;
  valor?: string;
  rotulo?: string;
  indice?: string;
  titulo?: string;
  descricao?: string;
  itens?: string[];
  inputId?: string;
  legenda?: string;
}

export interface WorkiaDeck {
  tipo: 'deck';
  schemaVersion: number;
  titulo: string;
  slides: {
    id: string;
    layout: string;
    titulo: string;
    destaque?: string;
    subtitulo?: string;
    notas?: string;
    blocos: WorkiaBlock[];
  }[];
}

export interface WorkiaCronograma {
  tipo: 'cronograma';
  schemaVersion: number;
  titulo: string;
  inicio: string;
  calendario: { diasUteis: number[]; feriados: string[] };
  notas?: string;
  tarefas: {
    id: string;
    nome: string;
    grupo?: string;
    duracaoDias: number;
    marco?: boolean;
    responsavel?: string;
    descricao?: string;
    dependencias: { tarefaId: string; tipo: 'FS' | 'SS' | 'FF' | 'SF'; defasagemDias?: number }[];
  }[];
}

export type WorkiaArtifact = WorkiaDocumento | WorkiaPlanilha | WorkiaDeck | WorkiaCronograma;
