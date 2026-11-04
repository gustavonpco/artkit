// @vitest-environment jsdom
import { defaultTheme, type RenderContext } from '@artkit/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { layoutDiagram } from '../src/index.js';
import { DiagramRenderer, diagramCss } from '../src/react/index.js';
import { flow, layered } from './fixtures.js';

const screenCtx: RenderContext = { theme: defaultTheme, locale: 'en', mode: 'screen' };

afterEach(cleanup);

describe('DiagramRenderer', () => {
  it('renders an accessible SVG with nodes, edges, groups and markers', () => {
    const { container } = render(<DiagramRenderer content={layered} ctx={screenCtx} />);
    const svg = screen.getByRole('img');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    const desc = container.querySelector('desc')!;
    expect(svg.getAttribute('aria-describedby')).toBe(desc.id);
    expect(desc.textContent).toContain('Portal web to API (HTTPS)');
    expect(container.querySelectorAll('.ak-diagram-node')).toHaveLength(layered.nodes.length);
    expect(container.querySelectorAll('.ak-diagram-edge')).toHaveLength(layered.edges.length);
    expect(container.querySelectorAll('.ak-diagram-group')).toHaveLength(layered.groups.length);
    expect(container.querySelector('.ak-diagram-tone-accent[data-id="api"]')).not.toBeNull();
    expect(container.querySelectorAll('marker')).toHaveLength(2);
    const markerEnd = container.querySelector('.ak-diagram-edge-line')!.getAttribute('marker-end')!;
    expect(container.querySelector(`marker[id="${markerEnd.slice(5, -1)}"]`)).not.toBeNull();
    expect(container.querySelector('.ak-diagram-edge--dashed')).not.toBeNull();
    expect(container.textContent).toContain('SERVIÇOS');
    const figure = container.querySelector('figure')!;
    expect(figure.style.getPropertyValue('--ak-color-accent')).toBe(defaultTheme.colors.accent);
  });

  it('zooms and pans with buttons, keyboard, wheel and drag', () => {
    const { container } = render(<DiagramRenderer content={flow} ctx={screenCtx} />);
    const svg = container.querySelector('svg.ak-diagram-svg')!;
    const viewport = container.querySelector('.ak-diagram-viewport') as HTMLElement;
    const initial = svg.getAttribute('viewBox')!;
    const width = () => Number(svg.getAttribute('viewBox')!.split(' ')[2]);
    const baseWidth = width();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(width()).toBeLessThan(baseWidth);
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(svg.getAttribute('viewBox')).toBe(initial);
    fireEvent.keyDown(viewport, { key: '-' });
    expect(width()).toBeGreaterThan(baseWidth);
    fireEvent.keyDown(viewport, { key: '0' });
    fireEvent.keyDown(viewport, { key: 'ArrowRight' });
    expect(Number(svg.getAttribute('viewBox')!.split(' ')[0])).toBeGreaterThan(Number(initial.split(' ')[0]));
    fireEvent.keyDown(viewport, { key: '0' });
    act(() => {
      viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    });
    expect(width()).toBeLessThan(baseWidth);
    fireEvent.keyDown(viewport, { key: '0' });
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 60, clientY: 100 });
    fireEvent.pointerUp(viewport, { pointerId: 1 });
    expect(Number(svg.getAttribute('viewBox')!.split(' ')[0])).toBeCloseTo(
      Number(initial.split(' ')[0]) + 40,
      1,
    );
    expect(viewport.getAttribute('tabindex')).toBe('0');
    expect(viewport.getAttribute('aria-label')).toContain('zoom');
  });

  it('renders a fixed drawing in print mode', () => {
    const { container } = render(
      <DiagramRenderer content={layered} ctx={{ ...screenCtx, mode: 'print', locale: 'pt-BR' }} />,
    );
    expect(container.querySelector('.ak-diagram-toolbar')).toBeNull();
    const viewport = container.querySelector('.ak-diagram-viewport')!;
    expect(viewport.getAttribute('tabindex')).toBeNull();
    const layout = layoutDiagram(layered);
    expect(container.querySelector('svg.ak-diagram-svg')!.getAttribute('viewBox')).toBe(
      `${layout.bounds.x} ${layout.bounds.y} ${layout.bounds.width} ${layout.bounds.height}`,
    );
    expect(container.querySelector('title')!.textContent).toBe('Diagrama');
    expect(container.querySelector('figure')!.className).toContain('ak-diagram--print');
  });

  it('accepts a precomputed layout and exposes CSS', () => {
    const layout = layoutDiagram(flow);
    const { container } = render(
      <DiagramRenderer
        content={flow}
        ctx={{ ...screenCtx, provisional: true }}
        layout={{ ...layout, engine: 'custom' }}
      />,
    );
    expect(container.querySelector('figure')!.getAttribute('data-engine')).toBe('custom');
    expect(container.querySelector('figure')!.className).toContain('ak-diagram--provisional');
    expect(diagramCss).toContain('.ak-diagram-tone-accent');
    expect(diagramCss).not.toContain('@import');
  });
});
