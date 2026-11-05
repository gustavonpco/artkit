/* biome-ignore-all lint/suspicious/noExplicitAny: component props arrive typed by the OpenUI runtime, per schema. */
/* biome-ignore-all lint/suspicious/noArrayIndexKey: children and grid cells are positional and never reordered. */

import { createLibrary, defineComponent, useRenderNode } from '@openuidev/react-lang';
import { type ReactNode, useState } from 'react';
import { uiComponents } from '../catalog.js';

type Props = Record<string, any>;
type Render = (props: Props, children: (value: unknown) => ReactNode) => ReactNode;

const kids = (items: unknown, render: (value: unknown) => ReactNode) =>
  Array.isArray(items) ? items.map((item, index) => <div key={index}>{render(item)}</div>) : null;

const bars = (series: { label: string; value: number }[] = []) => {
  const max = Math.max(1, ...series.map((point) => point.value));
  return (
    <div className="ak-chart-bars" role="img" aria-label="gráfico de barras">
      {series.map((point) => (
        <div key={point.label} className="ak-chart-bar">
          <span style={{ height: `${(point.value / max) * 100}%` }} />
          <small>{point.label}</small>
        </div>
      ))}
    </div>
  );
};

const line = (series: { label: string; value: number }[] = []) => {
  const max = Math.max(1, ...series.map((point) => point.value));
  const points = series.map(
    (point, index) => `${(index / Math.max(1, series.length - 1)) * 300},${100 - (point.value / max) * 90}`,
  );
  return (
    <svg viewBox="0 0 300 110" className="ak-chart-line" role="img" aria-label="gráfico de linha">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="var(--ak-color-accent, #2563eb)"
        strokeWidth="2"
      />
    </svg>
  );
};

const pie = (series: { label: string; value: number }[] = []) => {
  const total = Math.max(
    1,
    series.reduce((sum, point) => sum + point.value, 0),
  );
  let angle = 0;
  const slices = series.map((point, index) => {
    const start = angle;
    angle += (point.value / total) * 2 * Math.PI;
    const large = angle - start > Math.PI ? 1 : 0;
    const [x1, y1] = [50 + 45 * Math.cos(start), 50 + 45 * Math.sin(start)];
    const [x2, y2] = [50 + 45 * Math.cos(angle), 50 + 45 * Math.sin(angle)];
    return (
      <path
        key={point.label}
        d={`M50 50 L${x1} ${y1} A45 45 0 ${large} 1 ${x2} ${y2} Z`}
        fill={`var(--ak-chart-${(index % 6) + 1}, hsl(${index * 60} 60% 50%))`}
      />
    );
  });
  return (
    <div className="ak-chart-pie">
      <svg viewBox="0 0 100 100" role="img" aria-label="gráfico de pizza">
        {slices}
      </svg>
      <ul>
        {series.map((point) => (
          <li key={point.label}>
            {point.label}: {point.value}
          </li>
        ))}
      </ul>
    </div>
  );
};

const renderers: Record<string, Render> = {
  Page: (p, c) => (
    <main className="ak-page">
      <h1>{p.title}</h1>
      {kids(p.children, c)}
    </main>
  ),
  Section: (p, c) => (
    <section className="ak-section">
      <h2>{p.title}</h2>
      {kids(p.children, c)}
    </section>
  ),
  Grid: (p, c) => (
    <div className="ak-grid" style={{ gridTemplateColumns: `repeat(${p.columns ?? 2}, minmax(0, 1fr))` }}>
      {kids(p.children, c)}
    </div>
  ),
  Columns: (p, c) => (
    <div className="ak-columns" style={{ display: 'flex', gap: '1rem' }}>
      {kids(p.children, c)}
    </div>
  ),
  Card: (p, c) => (
    <article className="ak-card">
      {p.title ? <h3>{p.title}</h3> : null}
      {kids(p.children, c)}
    </article>
  ),
  Divider: () => <hr />,
  Title: (p) => <h2 className="ak-title">{p.text}</h2>,
  Subtitle: (p) => <p className="ak-subtitle">{p.text}</p>,
  Heading: (p) => {
    const Tag = `h${Math.min(4, p.level ?? 2) + 1}` as 'h2';
    return <Tag>{p.text}</Tag>;
  },
  Text: (p) => <p>{p.text}</p>,
  Bullets: (p) => (
    <ul>
      {(p.items ?? []).map((item: string) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  ),
  Callout: (p) => (
    <aside className={`ak-callout ak-callout-${p.kind ?? 'note'}`} role="note">
      {p.text}
    </aside>
  ),
  Quote: (p) => (
    <blockquote>
      {p.text}
      {p.author ? <footer>— {p.author}</footer> : null}
    </blockquote>
  ),
  Image: (p) => <img src={/^https:\/\//.test(p.src) ? p.src : undefined} alt={p.alt} />,
  StatCard: (p) => (
    <div className="ak-stat">
      <small>{p.label}</small>
      <strong>{p.value}</strong>
      {p.delta ? <span>{p.delta}</span> : null}
    </div>
  ),
  Table: (p) => (
    <table className="ak-table">
      <thead>
        <tr>
          {(p.headers ?? []).map((h: string) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {(p.rows ?? []).map((row: string[], i: number) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
  BarChart: (p) => (
    <figure>
      {p.title ? <figcaption>{p.title}</figcaption> : null}
      {bars(p.series)}
    </figure>
  ),
  LineChart: (p) => (
    <figure>
      {p.title ? <figcaption>{p.title}</figcaption> : null}
      {line(p.series)}
    </figure>
  ),
  PieChart: (p) => (
    <figure>
      {p.title ? <figcaption>{p.title}</figcaption> : null}
      {pie(p.series)}
    </figure>
  ),
  StackedBarChart: (p) => (
    <figure>
      {p.title ? <figcaption>{p.title}</figcaption> : null}
      <table className="ak-table">
        <thead>
          <tr>
            <th scope="col" />{' '}
            {(p.categories ?? []).map((c: string) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(p.series ?? []).map((s: any) => (
            <tr key={s.name}>
              <th scope="row">{s.name}</th>
              {s.values.map((v: number, i: number) => (
                <td key={i}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  ),
  Progress: (p) => (
    <div className="ak-progress">
      <span>{p.label}</span>
      <meter min={0} max={100} value={p.value}>
        {p.value}%
      </meter>
    </div>
  ),
  Badge: (p) => <span className={`ak-badge ak-badge-${p.tone ?? 'neutral'}`}>{p.text}</span>,
  Deck: (p, c) => (
    <div className="ak-deck">
      {p.title ? <h1>{p.title}</h1> : null}
      {kids(p.slides, c)}
    </div>
  ),
  Slide: (p, c) => <section className={`ak-slide ak-slide-${p.layout}`}>{kids(p.children, c)}</section>,
  Notes: (p) => (
    <aside className="ak-notes" aria-label="notas do apresentador">
      {p.text}
    </aside>
  ),
  Dashboard: (p, c) => (
    <div className="ak-dashboard">
      <h1>{p.title}</h1>
      {kids(p.children, c)}
    </div>
  ),
  Report: (p, c) => (
    <article className="ak-report">
      <h1>{p.title}</h1>
      {kids(p.children, c)}
    </article>
  ),
  Filter: (p) => (
    <label className="ak-filter">
      {p.label}{' '}
      <select>
        {(p.options ?? []).map((o: string) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  ),
  KpiRow: (p, c) => (
    <div className="ak-kpi-row" style={{ display: 'flex', gap: '1rem' }}>
      {kids(p.children, c)}
    </div>
  ),
  Prototype: (p, c) => <PrototypeView title={p.title} screens={p.screens} render={c} />,
  Screen: (p, c) => (
    <section className="ak-screen" aria-label={p.name}>
      <h2>{p.name}</h2>
      {kids(p.children, c)}
    </section>
  ),
  Nav: (p) => (
    <nav className="ak-nav">
      {(p.items ?? []).map((item: string) => (
        <span key={item}>{item}</span>
      ))}
    </nav>
  ),
  Form: (p, c) => (
    <form className="ak-form" onSubmit={(e) => e.preventDefault()}>
      {p.title ? <h3>{p.title}</h3> : null}
      {kids(p.children, c)}
    </form>
  ),
  Input: (p) => (
    <label>
      {p.label}
      <input placeholder={p.placeholder} />
    </label>
  ),
  Select: (p) => (
    <label>
      {p.label}
      <select>
        {(p.options ?? []).map((o: string) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  ),
  Button: (p) => <button type="button">{p.label}</button>,
  Modal: (p, c) => (
    <div role="dialog" aria-label={p.title} className="ak-modal">
      <h3>{p.title}</h3>
      {kids(p.children, c)}
    </div>
  ),
  Diagram: (p) => (
    <div className={`ak-diagram ak-diagram-${p.kind ?? 'flow'}`}>
      <ul aria-label="nós">
        {(p.nodes ?? []).map((n: any) => (
          <li key={n.id}>{n.label}</li>
        ))}
      </ul>
      <ul aria-label="conexões">
        {(p.edges ?? []).map((e: any, i: number) => (
          <li key={i}>
            {e.from} → {e.to}
            {e.label ? ` (${e.label})` : ''}
          </li>
        ))}
      </ul>
    </div>
  ),
};

function PrototypeView({
  title,
  screens,
  render,
}: {
  title: string;
  screens: unknown[];
  render: (value: unknown) => ReactNode;
}) {
  const [index, setIndex] = useState(0);
  return (
    <div className="ak-prototype">
      <h1>{title}</h1>
      <div className="ak-prototype-nav">
        {(screens ?? []).map((_screen, i) => (
          <button key={i} type="button" aria-pressed={i === index} onClick={() => setIndex(i)}>
            Tela {i + 1}
          </button>
        ))}
      </div>
      {screens?.[index] !== undefined ? render(screens[index]) : null}
    </div>
  );
}

/** Render function for one component: the runtime passes its parsed props and a renderer for child nodes. */
function ComponentView({ name, props }: { name: string; props: Props }) {
  const children = useRenderNode();
  const render = renderers[name];
  return <>{render ? render(props, children) : null}</>;
}

/** The react-lang library of the artkit catalog: same names, descriptions and schemas, plus the React renderers. */
export const uiReactComponents = uiComponents.map((component) =>
  defineComponent({
    name: component.name,
    description: component.description,
    props: component.props as never,
    component: ({ props }: { props: Props }) => <ComponentView name={component.name} props={props} />,
  }),
);

export const uiReactLibrary = createLibrary({ components: uiReactComponents as never, root: 'Deck' });
