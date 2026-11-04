import type { LintIssue, Theme } from '@artkit/core';
import {
  Button,
  ButtonRow,
  ColorPicker,
  Hint,
  InspectorSection,
  Inspector as Panel,
  Segmented,
} from '@artkit/react';
import { ArrowRightLeft, Pin, PinOff, Trash2 } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useId } from 'react';
import type { DiagramOperation } from '../operations.js';
import {
  type DiagramContent,
  type EDGE_ARROWS,
  EDGE_LABEL_MAX,
  type EDGE_STYLES,
  type GROUP_KINDS,
  GROUP_LABEL_MAX,
  NODE_ICONS,
  NODE_LABEL_MAX,
  NODE_SHAPES,
} from '../schema.js';
import { msg } from '../text.js';
import { labelEditOperation } from './convert.js';

export interface Selection {
  nodes: string[];
  edges: string[];
  group?: string;
}

interface InspectorProps {
  content: DiagramContent;
  selection: Selection;
  readOnly: boolean;
  locale: string;
  theme: Theme;
  lint: Map<string, LintIssue[]>;
  send(ops: DiagramOperation[], announce: string): void;
}

function TextField({
  label,
  value,
  maxLength,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  maxLength: number;
  disabled: boolean;
  onCommit(value: string): void;
}) {
  const id = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      event.currentTarget.value = value;
      event.currentTarget.blur();
    }
  };
  return (
    <div className="ak-ctl-field">
      <label className="ak-ctl-label" htmlFor={id}>
        {label}
      </label>
      {/* `key` resets the uncontrolled input when the selected item changes from outside. */}
      <input
        key={value}
        id={id}
        className="ak-ctl-input"
        defaultValue={value}
        maxLength={maxLength}
        disabled={disabled}
        onKeyDown={onKeyDown}
        onBlur={(event) => onCommit(event.currentTarget.value)}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange(value: string): void;
}) {
  const id = useId();
  return (
    <div className="ak-ctl-field">
      <label className="ak-ctl-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="ak-ctl-select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const plain = (values: readonly string[]) => values.map((value) => ({ value, label: value }));

function Issues({ items }: { items: ReactNode[] }) {
  return items.length > 0 ? <ul className="ak-diagram-editor-issues">{items}</ul> : null;
}

/** Properties of the selected node, edge or group. Every change becomes one kind operation. */
export function Inspector({ content, selection, readOnly, locale, theme, lint, send }: InspectorProps) {
  const t = (en: string, pt: string) => msg(locale, en, pt);
  const none = { value: '', label: t('(none)', '(nenhum)') };
  const issues = (target: string) =>
    (lint.get(target) ?? []).map((issue) => (
      <li key={`${issue.code}-${issue.message}`} className={`ak-diagram-editor-lint is-${issue.severity}`}>
        {issue.message}
        {issue.hint ? <span> {issue.hint}</span> : null}
      </li>
    ));
  const title = (kind: string, id: string) => (
    <>
      {kind} <code>{id}</code>
    </>
  );
  const shapeLabels: Record<(typeof NODE_SHAPES)[number], string> = {
    box: t('Box', 'Caixa'),
    round: t('Rounded', 'Arredondado'),
    diamond: t('Decision', 'Decisão'),
    ellipse: t('Ellipse', 'Elipse'),
    cylinder: t('Database', 'Banco de dados'),
    document: t('Document', 'Documento'),
    actor: t('Person', 'Pessoa'),
  };

  let section: ReactNode;
  const group = selection.group ? content.groups.find((item) => item.id === selection.group) : undefined;
  const node =
    !group && selection.nodes.length === 1 && selection.edges.length === 0
      ? content.nodes.find((item) => item.id === selection.nodes[0])
      : undefined;
  const edge =
    !group && selection.edges.length === 1 && selection.nodes.length === 0
      ? content.edges.find((item) => item.id === selection.edges[0])
      : undefined;

  if (group) {
    section = (
      <InspectorSection
        title={title(t('Group', 'Grupo'), group.id)}
        label={t('Group properties', 'Propriedades do grupo')}
      >
        <TextField
          label={t('Label', 'Rótulo')}
          value={group.label}
          maxLength={GROUP_LABEL_MAX}
          disabled={readOnly}
          onCommit={(value) => {
            const op = labelEditOperation('group', group.id, group.label, value);
            if (op) send([op], t('Group renamed', 'Grupo renomeado'));
          }}
        />
        <SelectField
          label={t('Kind', 'Tipo')}
          value={group.kind}
          options={[
            { value: 'band', label: t('Band (layer or lane)', 'Faixa (camada ou raia)') },
            { value: 'box', label: t('Box', 'Caixa') },
          ]}
          disabled={readOnly}
          onChange={(value) =>
            send(
              [{ op: 'update_group', id: group.id, kind: value as (typeof GROUP_KINDS)[number] }],
              t('Group updated', 'Grupo atualizado'),
            )
          }
        />
        <ButtonRow>
          <Button
            icon={Trash2}
            variant="danger"
            disabled={readOnly}
            onClick={() => send([{ op: 'remove_group', id: group.id }], t('Group removed', 'Grupo removido'))}
          >
            {t('Remove group (keep nodes)', 'Remover grupo (manter nós)')}
          </Button>
        </ButtonRow>
        <Issues items={issues(`group:${group.id}`)} />
      </InspectorSection>
    );
  } else if (node) {
    const update = (patch: Omit<Extract<DiagramOperation, { op: 'update_node' }>, 'op' | 'id'>) =>
      send([{ op: 'update_node', id: node.id, ...patch }], t('Node updated', 'Nó atualizado'));
    section = (
      <InspectorSection
        title={title(t('Node', 'Nó'), node.id)}
        label={t('Node properties', 'Propriedades do nó')}
      >
        <TextField
          label={t('Label', 'Rótulo')}
          value={node.label}
          maxLength={NODE_LABEL_MAX}
          disabled={readOnly}
          onCommit={(value) => {
            const op = labelEditOperation('node', node.id, node.label, value);
            if (op) send([op], t('Node renamed', 'Nó renomeado'));
          }}
        />
        <SelectField
          label={t('Shape', 'Forma')}
          value={node.shape}
          options={NODE_SHAPES.map((shape) => ({ value: shape, label: shapeLabels[shape] }))}
          disabled={readOnly}
          onChange={(value) => update({ shape: value as (typeof NODE_SHAPES)[number] })}
        />
        <ColorPicker
          label={t('Tone', 'Tom')}
          value={node.tone}
          theme={theme}
          locale={locale}
          allowNone
          disabled={readOnly}
          onChange={(tone) =>
            update({ tone: tone === undefined ? null : (tone as NonNullable<typeof node.tone>) })
          }
        />
        <SelectField
          label={t('Icon', 'Ícone')}
          value={node.icon ?? ''}
          options={[none, ...plain(NODE_ICONS)]}
          disabled={readOnly}
          onChange={(value) => update({ icon: value === '' ? null : (value as (typeof NODE_ICONS)[number]) })}
        />
        <SelectField
          label={t('Group', 'Grupo')}
          value={node.group ?? ''}
          options={[none, ...content.groups.map((item) => ({ value: item.id, label: item.label }))]}
          disabled={readOnly}
          onChange={(value) => update({ group: value === '' ? null : value })}
        />
        {node.position ? (
          <ButtonRow>
            <Button
              icon={PinOff}
              disabled={readOnly}
              onClick={() => send([{ op: 'unpin_node', id: node.id }], t('Node unpinned', 'Nó liberado'))}
            >
              {t('Unpin position', 'Liberar posição')}
            </Button>
          </ButtonRow>
        ) : (
          <Hint>
            <Pin aria-hidden="true" className="ak-diagram-editor-hint-icon" />
            {t('Drag the node to pin its position.', 'Arraste o nó para fixar a posição.')}
          </Hint>
        )}
        <Issues items={issues(`node:${node.id}`)} />
      </InspectorSection>
    );
  } else if (edge) {
    const labelOf = (id: string) => content.nodes.find((item) => item.id === id)?.label ?? id;
    section = (
      <InspectorSection
        title={title(t('Edge', 'Aresta'), edge.id)}
        label={t('Edge properties', 'Propriedades da aresta')}
      >
        <p className="ak-diagram-editor-route">
          <span>{labelOf(edge.from)}</span> → <span>{labelOf(edge.to)}</span>
        </p>
        <TextField
          label={t('Label', 'Rótulo')}
          value={edge.label ?? ''}
          maxLength={EDGE_LABEL_MAX}
          disabled={readOnly}
          onCommit={(value) => {
            const op = labelEditOperation('edge', edge.id, edge.label, value);
            if (op) send([op], t('Edge label changed', 'Rótulo da aresta alterado'));
          }}
        />
        <SelectField
          label={t('Line', 'Linha')}
          value={edge.style}
          options={[
            { value: 'solid', label: t('Solid', 'Contínua') },
            { value: 'dashed', label: t('Dashed', 'Tracejada') },
          ]}
          disabled={readOnly}
          onChange={(value) =>
            send(
              [{ op: 'update_edge', id: edge.id, style: value as (typeof EDGE_STYLES)[number] }],
              t('Edge updated', 'Aresta atualizada'),
            )
          }
        />
        <div className="ak-ctl-field">
          <span className="ak-ctl-label">{t('Arrow', 'Seta')}</span>
          <Segmented
            label={t('Arrow', 'Seta')}
            value={edge.arrow}
            disabled={readOnly}
            options={[
              { value: 'end', label: t('End', 'Destino') },
              { value: 'both', label: t('Both', 'Ambas') },
              { value: 'none', label: t('None', 'Nenhuma') },
            ]}
            onChange={(value) =>
              send(
                [{ op: 'update_edge', id: edge.id, arrow: value as (typeof EDGE_ARROWS)[number] }],
                t('Edge updated', 'Aresta atualizada'),
              )
            }
          />
        </div>
        <ButtonRow>
          <Button
            icon={ArrowRightLeft}
            disabled={readOnly}
            onClick={() =>
              send(
                [{ op: 'update_edge', id: edge.id, from: edge.to, to: edge.from }],
                t('Edge reversed', 'Aresta invertida'),
              )
            }
          >
            {t('Reverse direction', 'Inverter sentido')}
          </Button>
        </ButtonRow>
        <Issues items={issues(`edge:${edge.id}`)} />
      </InspectorSection>
    );
  } else {
    const count = selection.nodes.length + selection.edges.length;
    section = (
      <InspectorSection title={t('Selection', 'Seleção')} label={t('Selection', 'Seleção')}>
        <Hint>
          {count === 0
            ? t(
                'Select a node, edge or group label to edit it. Drag nodes to pin them, drag from a handle to connect, double-click to rename, Shift+drag to select several.',
                'Selecione um nó, aresta ou rótulo de grupo para editar. Arraste nós para fixá-los, arraste de um conector para ligar, dê duplo clique para renomear, Shift+arrastar seleciona vários.',
              )
            : t(`${count} items selected.`, `${count} itens selecionados.`)}
        </Hint>
      </InspectorSection>
    );
  }

  return (
    <Panel label={t('Properties', 'Propriedades')} className="ak-diagram-editor-side">
      {section}
      <InspectorSection title={t('Diagram', 'Diagrama')}>
        <dl className="ak-diagram-editor-stats">
          <div>
            <dt>{t('Nodes', 'Nós')}</dt>
            <dd>{content.nodes.length}</dd>
          </div>
          <div>
            <dt>{t('Edges', 'Arestas')}</dt>
            <dd>{content.edges.length}</dd>
          </div>
          <div>
            <dt>{t('Groups', 'Grupos')}</dt>
            <dd>{content.groups.length}</dd>
          </div>
        </dl>
      </InspectorSection>
    </Panel>
  );
}
