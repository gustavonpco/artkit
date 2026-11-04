import { createElement, type ReactNode } from 'react';
import type { SceneElement } from '../scene.js';

const camel = (name: string) =>
  name.startsWith('data-') || name.startsWith('aria-')
    ? name
    : name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** Renders a scene element as React SVG; paint roles become `ak-diagram-fill-*`/`ak-diagram-stroke-*` classes. */
export function renderSceneElement(
  element: SceneElement,
  key: string | number,
  markers?: { start: string; end: string },
): ReactNode {
  const props: Record<string, unknown> = { key };
  for (const [name, value] of Object.entries(element.attrs)) props[camel(name)] = value;
  const classes = [element.className];
  if (element.fill) classes.push(`ak-diagram-fill-${element.fill}`);
  if (element.stroke) classes.push(`ak-diagram-stroke-${element.stroke}`);
  const className = classes.filter(Boolean).join(' ');
  if (className) props.className = className;
  if (markers && element.markers?.end) props.markerEnd = `url(#${markers.end})`;
  if (markers && element.markers?.start) props.markerStart = `url(#${markers.start})`;
  const children: ReactNode[] = [];
  if (element.text !== undefined) children.push(element.text);
  element.children?.forEach((child, index) => {
    children.push(renderSceneElement(child, index, markers));
  });
  return createElement(element.tag, props, ...children);
}
