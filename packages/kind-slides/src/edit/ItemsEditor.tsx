import { Plus } from 'lucide-react';
import type { ReactElement } from 'react';
import { tr } from '../i18n.js';
import { TextField } from './controls.js';

export interface ItemField {
  key: string;
  label: string;
  multiline?: boolean;
  /** List fields are edited one entry per line. */
  list?: boolean;
  /** Required fields are kept as "" instead of being removed when cleared. */
  required?: boolean;
}

export interface ItemsEditorProps<T extends Record<string, unknown>> {
  items: T[];
  fields: ItemField[];
  locale: string;
  max: number;
  disabled?: boolean;
  /** Item added by the "+" button. */
  create(): T;
  onChange(items: T[]): void;
  itemLabel(index: number): string;
}

/** Editor for repeatable slot items (stats, steps, cards): one fieldset per item, add/remove/reorder. */
export function ItemsEditor<T extends Record<string, unknown>>({
  items,
  fields,
  locale,
  max,
  disabled,
  create,
  onChange,
  itemLabel,
}: ItemsEditorProps<T>): ReactElement {
  const t = (en: string, pt: string) => tr(locale, en, pt);
  const setField = (index: number, field: ItemField, text: string) => {
    const next = items.map((item, i) => {
      if (i !== index) return item;
      const copy: Record<string, unknown> = { ...item };
      if (field.list) {
        const lines = text
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length > 0) copy[field.key] = lines;
        else delete copy[field.key];
      } else if (text === '' && !field.required) delete copy[field.key];
      else copy[field.key] = text;
      return copy as T;
    });
    onChange(next);
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    onChange(next);
  };
  return (
    <div className="ak-slides-items">
      {items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional cells/runs have no identity and never reorder
        <fieldset key={index} className="ak-ctl-card" disabled={disabled}>
          <legend>{itemLabel(index)}</legend>
          {fields.map((field) => {
            const value = item[field.key];
            const text = Array.isArray(value) ? value.join('\n') : typeof value === 'string' ? value : '';
            return (
              <TextField
                key={field.key}
                label={field.label}
                value={text}
                multiline={field.multiline || field.list}
                onCommit={(next) => setField(index, field, next)}
              />
            );
          })}
          <div className="ak-ctl-buttons">
            <button
              type="button"
              onClick={() => move(index, -1)}
              disabled={index === 0}
              aria-label={`${t('Move up', 'Mover para cima')}: ${itemLabel(index)}`}
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(index, 1)}
              disabled={index === items.length - 1}
              aria-label={`${t('Move down', 'Mover para baixo')}: ${itemLabel(index)}`}
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              disabled={items.length <= 1}
              aria-label={`${t('Remove', 'Remover')}: ${itemLabel(index)}`}
            >
              {t('Remove', 'Remover')}
            </button>
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={disabled || items.length >= max}
        onClick={() => onChange([...items, create()])}
      >
        <Plus aria-hidden="true" />
        {t('Add item', 'Adicionar item')}
      </button>
    </div>
  );
}
