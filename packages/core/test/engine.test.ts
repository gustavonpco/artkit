// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ArtifactError, applyOperations, createRegistry, prepareContent } from '../src/index.js';
import { contractText } from './contract-text.js';

const registry = createRegistry({ formats: [contractText] });
const base = { format: 'contract-text', content: 'Hello', title: 'Doc', themeId: 'default', locale: 'en' };

describe('applyOperations', () => {
  it('applies content operations in order and reports the diff', async () => {
    const result = await applyOperations(registry, base, [
      { op: 'replace_text', find: 'Hello', replace: 'Hi' },
      { op: 'append', text: '!' },
    ]);
    expect(result.content).toBe('Hi!');
    expect(result.diff.some((change) => change.target === 'text')).toBe(true);
    expect(result.createdRefs).toHaveLength(1);
  });

  it('keeps the input untouched and rejects the whole batch when one operation fails', async () => {
    const frozen = structuredClone(base);
    await expect(
      applyOperations(registry, base, [
        { op: 'append', text: ' world' },
        { op: 'replace_text', find: 'missing', replace: 'x' },
      ]),
    ).rejects.toMatchObject({ code: 'OPERATION_FAILED' });
    expect(base).toEqual(frozen);
  });

  it('reports the index of an invalid operation', async () => {
    const error = await applyOperations(registry, base, [{ op: 'append', text: 'ok' }, { op: 'nope' }]).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(ArtifactError);
    expect(error.code).toBe('INVALID_OPERATION');
    expect(error.issues[0].path).toMatch(/^operations\[1\]/);
  });

  it('updates envelope fields through envelope operations', async () => {
    const result = await applyOperations(registry, base, [
      { op: 'set_title', title: 'Novo título' },
      { op: 'set_locale', locale: 'pt-BR' },
    ]);
    expect(result.title).toBe('Novo título');
    expect(result.locale).toBe('pt-BR');
  });

  it('enforces limits on the resulting content', async () => {
    const error = await applyOperations(registry, base, [{ op: 'append', text: 'x'.repeat(2000) }]).catch(
      (e) => e,
    );
    expect(error.code).toBe('LIMIT_EXCEEDED');
  });

  it('is deterministic for the same input', async () => {
    const batch = [{ op: 'append', text: '!' }];
    const a = await applyOperations(registry, base, batch);
    const b = await applyOperations(registry, base, batch);
    expect(a.content).toBe(b.content);
  });
});

describe('prepareContent', () => {
  it('validates raw content and returns lint', () => {
    const prepared = prepareContent(registry, 'contract-text', 'Texto');
    expect(prepared.content).toBe('Texto');
    expect(prepared.lint).toEqual([]);
  });

  it('rejects content that the adapter refuses', () => {
    expect(() => prepareContent(registry, 'contract-text', 42)).toThrow(ArtifactError);
  });
});
