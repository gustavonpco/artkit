import type { DiagramContent } from '../src/index.js';

/** Layered architecture used across tests (spec §9.3 example). */
export const layered: DiagramContent = {
  direction: 'TB',
  layout: 'bands',
  groups: [
    { id: 'canais', label: 'Canais', kind: 'band' },
    { id: 'servicos', label: 'Serviços', kind: 'band' },
    { id: 'dados', label: 'Dados', kind: 'band' },
  ],
  nodes: [
    { id: 'web', label: 'Portal web', shape: 'box', group: 'canais', icon: 'web' },
    { id: 'app', label: 'App mobile', shape: 'round', group: 'canais', icon: 'mobile' },
    { id: 'api', label: 'API', shape: 'round', group: 'servicos', tone: 'accent' },
    { id: 'auth', label: 'Auth', shape: 'box', group: 'servicos' },
    { id: 'pg', label: 'PostgreSQL', shape: 'cylinder', group: 'dados' },
    { id: 'files', label: 'Arquivos', shape: 'document', group: 'dados' },
  ],
  edges: [
    { id: 'e1', from: 'web', to: 'api', label: 'HTTPS', style: 'solid', arrow: 'end' },
    { id: 'e2', from: 'app', to: 'api', label: 'HTTPS', style: 'solid', arrow: 'end' },
    { id: 'e3', from: 'api', to: 'auth', style: 'dashed', arrow: 'end' },
    { id: 'e4', from: 'api', to: 'pg', style: 'solid', arrow: 'end' },
    { id: 'e5', from: 'api', to: 'files', style: 'solid', arrow: 'both' },
    { id: 'e6', from: 'web', to: 'pg', label: 'relatórios', style: 'dashed', arrow: 'end' },
  ],
};

export const flow: DiagramContent = {
  direction: 'LR',
  layout: 'auto',
  groups: [],
  nodes: [
    { id: 'start', label: 'Start', shape: 'ellipse' },
    { id: 'check', label: 'Valid?', shape: 'diamond' },
    { id: 'save', label: 'Save', shape: 'box' },
    { id: 'reject', label: 'Reject', shape: 'box', tone: 'danger' },
    { id: 'user', label: 'Customer', shape: 'actor' },
  ],
  edges: [
    { id: 'f1', from: 'user', to: 'start', style: 'solid', arrow: 'end' },
    { id: 'f2', from: 'start', to: 'check', style: 'solid', arrow: 'end' },
    { id: 'f3', from: 'check', to: 'save', label: 'yes', style: 'solid', arrow: 'end' },
    { id: 'f4', from: 'check', to: 'reject', label: 'no', style: 'solid', arrow: 'end' },
    { id: 'f5', from: 'reject', to: 'start', label: 'retry', style: 'dashed', arrow: 'end' },
    { id: 'f6', from: 'save', to: 'save', label: 'batch', style: 'solid', arrow: 'end' },
  ],
};
