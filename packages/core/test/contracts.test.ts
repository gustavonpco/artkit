// @vitest-environment node
import { describe, it } from 'vitest';
import { createMemoryStore } from '../src/index.js';
import { defineFormatConformanceTests, defineStoreContractTests } from '../src/testing/index.js';
import { contractText } from './contract-text.js';

defineStoreContractTests('memory', () => createMemoryStore(), { describe, it });

defineFormatConformanceTests(
  contractText,
  [
    { title: 'texto simples', content: 'Olá mundo' },
    {
      title: 'com lote',
      content: 'Base',
      batches: [[{ op: 'append', text: '!' }], [{ op: 'replace_text', find: 'Base', replace: 'Nova' }]],
      rejects: [
        { operations: [{ op: 'replace_text', find: 'nada', replace: 'x' }], code: 'OPERATION_FAILED' },
      ],
    },
  ],
  { describe, it },
);
