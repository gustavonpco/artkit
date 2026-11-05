import '@univerjs/preset-sheets-core/lib/index.css';
import { defaultTheme } from '@artkit-ai/core';
import type { WorkbookContent } from '@artkit-ai/format-sheet';
import { UniverSheetEditor } from '@artkit-ai/format-sheet/react/univer';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

const start: WorkbookContent = {
  id: 'demo',
  name: 'Estimativa',
  locale: 'pt-BR',
  sheetOrder: ['resumo'],
  sheets: {
    resumo: {
      id: 'resumo',
      name: 'Resumo',
      rowCount: 40,
      columnCount: 8,
      cellData: {
        '0': { '0': { v: 'Perfil' }, '1': { v: 'Horas' }, '2': { v: 'Valor hora' }, '3': { v: 'Total' } },
        '1': { '0': { v: 'Tech Lead' }, '1': { v: 120 }, '2': { v: 165 }, '3': { f: '=B2*C2', v: 19800 } },
        '2': { '0': { v: 'Dev' }, '1': { v: 80 }, '2': { v: 120 }, '3': { f: '=B3*C3', v: 9600 } },
      },
    },
  },
  styles: {},
  appVersion: '1',
  // A dropdown on the profile column: only these profiles are accepted there.
  validations: [{ sheet: 'resumo', range: 'A2:A20', list: ['Tech Lead', 'Dev', 'QA'] }],
};

function Demo() {
  const [content, setContent] = useState(start);
  const [log, setLog] = useState<string[]>([]);
  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 18 }}>Editor Univer</h1>
      <UniverSheetEditor
        content={content}
        ctx={{ theme: defaultTheme, locale: 'pt-BR', mode: 'screen' }}
        readOnly={false}
        lint={[]}
        emit={(operations) => {
          setLog((entries) => [...entries, JSON.stringify(operations)].slice(-8));
          // The demo applies the operations to its own copy so the editor sees the confirmed state.
          setContent((current) => current);
        }}
      />
      <pre id="ops" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
        {log.join('\n')}
      </pre>
      <button type="button" onClick={() => setContent(start)}>
        Restaurar
      </button>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
