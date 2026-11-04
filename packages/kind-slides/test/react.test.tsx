// @vitest-environment jsdom
import { defaultTheme, type RenderContext } from '@artkit-ai/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { slidesKind } from '../src/index.js';
import {
  ChartSvg,
  formatElapsed,
  SlidesPresentation,
  SlidesRenderer,
  SlideView,
  slidesCss,
} from '../src/react/index.js';
import { fullDeck } from './fixtures.js';

const ctx: RenderContext = {
  theme: defaultTheme,
  locale: 'en',
  mode: 'screen',
  resolveAssetUrl: (ref) => (ref === 'asset://photo' ? 'data:image/png;base64,AAAA' : undefined),
};
const content = slidesKind.contentSchema.parse(fullDeck);

afterEach(cleanup);

describe('SlideView', () => {
  it('positions in percent and sizes fonts in container units', () => {
    const slide = content.slides.find((item) => item.id === 'custom')!;
    const { container } = render(<SlideView slide={slide} ctx={ctx} slideNumber={7} />);
    const headline = container.querySelector<HTMLElement>('[data-element-id="headline"]')!;
    expect(headline.style.left).toBe(`${Math.round((0.6 / 13.333) * 100 * 10000) / 10000}%`);
    expect(headline.style.fontSize).toBe('3.3334cqw');
    expect(headline.textContent).toBe('Three markets');
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('Team photo');
    expect(container.querySelector('.ak-slides-line line')).not.toBeNull();
    expect(container.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toContain('pie chart');
    expect(container.querySelector('.ak-slides-slide')?.getAttribute('aria-label')).toBe('7: Three markets');
  });

  it('renders slots semantically: heading, lists, tables with th', () => {
    const { container } = render(
      <>
        <SlideView slide={content.slides[1]!} ctx={ctx} footer={content.footer} slideNumber={2} />
        <SlideView slide={content.slides[3]!} ctx={ctx} slideNumber={4} />
      </>,
    );
    expect(container.querySelector('h2')?.textContent).toBe('Manual onboarding takes 12 days');
    const items = container.querySelectorAll('ul.ak-slides-list > li');
    expect(items).toHaveLength(3);
    expect(items[2]!.getAttribute('data-level')).toBe('1');
    expect(container.querySelector('li strong, li span[style*="font-weight"]')?.textContent).toBe('twice');
    expect(container.querySelectorAll('th[scope="col"]')).toHaveLength(2);
    expect(container.textContent).toContain('Acme · Confidential');
  });

  it('shows a placeholder for unresolved images', () => {
    const slide = content.slides.find((item) => item.id === 'why')!;
    const { container } = render(<SlideView slide={slide} ctx={ctx} />);
    expect(container.querySelector('.ak-slides-image-missing')?.getAttribute('aria-label')).toBe(
      'Architecture',
    );
  });
});

describe('ChartSvg', () => {
  it('draws bars, lines, stacked bars and pies', () => {
    const base = {
      categories: ['A', 'B'],
      series: [
        { name: 'S', values: [1, 3] },
        { name: 'T', values: [2, -1] },
      ],
      showValues: true,
    };
    for (const chartType of ['bar', 'column', 'stackedBar'] as const) {
      const { container, unmount } = render(
        <ChartSvg chart={{ ...base, chartType }} width={6} height={4} theme={defaultTheme} locale="en" />,
      );
      expect(container.querySelectorAll('rect').length).toBeGreaterThanOrEqual(4);
      expect(container.textContent).toContain('S');
      unmount();
    }
    const line = render(
      <ChartSvg
        chart={{ ...base, chartType: 'line' }}
        width={6}
        height={4}
        theme={defaultTheme}
        locale="en"
      />,
    );
    expect(line.container.querySelectorAll('polyline')).toHaveLength(2);
    line.unmount();
    const pie = render(
      <ChartSvg
        chart={{ chartType: 'pie', categories: ['A', 'B'], series: [{ name: 'S', values: [1, 3] }] }}
        width={6}
        height={4}
        theme={defaultTheme}
        locale="en"
      />,
    );
    expect(pie.container.querySelectorAll('path')).toHaveLength(2);
    expect(pie.container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 432 288');
  });
});

describe('SlidesRenderer', () => {
  it('navigates slides, toggles notes and opens presentation mode', () => {
    render(<SlidesRenderer content={content} ctx={ctx} />);
    expect(screen.getByText('1 / 7')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(screen.getByText('2 / 7')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Slide 3/ }));
    expect(screen.getByText('3 / 7')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Speaker notes' }));
    expect(screen.getByRole('region', { name: 'Speaker notes' }).textContent).toBe('No speaker notes.');
    fireEvent.click(screen.getByRole('button', { name: 'Present' }));
    expect(screen.getByRole('dialog', { name: 'Presentation' })).toBeTruthy();
  });

  it('uses the standard toolbar and shows an overview grid', () => {
    const { container } = render(<SlidesRenderer content={content} ctx={ctx} />);
    expect(screen.getByRole('toolbar', { name: 'Slide viewer' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    const grid = screen.getByRole('list', { name: 'All slides' });
    expect(grid.querySelectorAll('.ak-slides-overview-item')).toHaveLength(7);
    expect(container.querySelector('.ak-slides-thumbs')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Slide 4' })[0]!);
    expect(screen.getByText('4 / 7')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'All slides' })).toBeNull();
  });

  it('opens the presenter view with the next slide, notes and a timer', () => {
    render(<SlidesRenderer content={content} ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Presenter view' }));
    const view = screen.getByRole('complementary', { name: 'Presenter view' });
    expect(view.textContent).toContain('Next');
    expect(screen.getByRole('timer', { name: 'Elapsed time' }).textContent).toBe('00:00');
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Presentation' }), { key: 'v' });
    expect(screen.queryByRole('complementary', { name: 'Presenter view' })).toBeNull();
  });

  it('formats elapsed time', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(65_000)).toBe('01:05');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
  });

  it('renders one slide when slideId is given', () => {
    const { container } = render(<SlidesRenderer content={content} ctx={ctx} slideId="kpis" />);
    expect(container.querySelectorAll('.ak-slides-slide')).toHaveLength(1);
    expect(container.textContent).toContain('40%');
  });

  it('print mode renders every visible slide on its own page', () => {
    const { container } = render(<SlidesRenderer content={content} ctx={{ ...ctx, mode: 'print' }} />);
    expect(container.querySelectorAll('.ak-slides-page')).toHaveLength(6);
    expect(slidesCss).toContain('@page { size: 13.333in 7.5in; margin: 0; }');
  });

  it('presentation mode skips hidden slides and handles keys', () => {
    let exited = false;
    const changes: string[] = [];
    render(
      <SlidesPresentation
        content={content}
        ctx={ctx}
        startSlideId="why"
        fullscreen={false}
        onExit={() => (exited = true)}
        onSlideChange={(id) => changes.push(id)}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(screen.getByText('6 / 6')).toBeTruthy();
    act(() => {
      fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    });
    expect(screen.getByText('6 / 6')).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Home' });
    expect(changes.at(-1)).toBe('cover');
    fireEvent.keyDown(dialog, { key: 's' });
    expect(screen.getByRole('region', { name: 'Speaker notes' }).textContent).toBe(
      'Open with the discovery meeting context.',
    );
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(exited).toBe(true);
  });
});
