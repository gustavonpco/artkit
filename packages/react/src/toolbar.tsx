import { COLOR_TOKENS, type ColorToken, type Theme } from '@artkit/core';
import { Check, ChevronDown, type LucideIcon, X } from 'lucide-react';
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

/*
 * Standard editor toolbar shared by every kind editor (document, sheet, slides, diagram) so all of them
 * look and behave the same: icon buttons with tooltips and shortcuts, grouped with dividers, selects,
 * dropdown menus and theme color palettes. Keyboard model follows the WAI-ARIA toolbar pattern: one tab
 * stop, arrows/Home/End move between controls, menus open with Enter/Space/ArrowDown and close with Escape.
 */

const ITEM = '[data-ak-tb-item]:not([disabled])';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** Keeps the editor selection (text, cells) when a toolbar control is clicked with the mouse. */
function keepSelection(event: MouseEvent) {
  event.preventDefault();
}

export interface ToolbarProps {
  label: string;
  children: ReactNode;
  className?: string;
  /** Stick to the top of the scrolling editor (default true). */
  sticky?: boolean;
}

export function Toolbar({ label, children, className, sticky = true }: ToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Roving tab index: only the active control is tabbable.
  const sync = useCallback((focusIndex?: number) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])].filter(
      (item) => !item.closest('[data-ak-tb-popover]'),
    );
    const active = focusIndex ?? Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    items.forEach((item, index) => {
      item.tabIndex = index === active ? 0 : -1;
    });
    return items;
  }, []);
  useEffect(() => {
    sync(0);
  });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-ak-tb-popover]')) return;
    if (
      (event.target as HTMLElement).tagName === 'SELECT' &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    )
      return;
    const items = sync();
    const current = items.indexOf(event.target as HTMLElement);
    if (current < 0) return;
    let next = -1;
    if (event.key === 'ArrowRight') next = (current + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    if (next < 0) return;
    event.preventDefault();
    sync(next);
    items[next]?.focus();
  };
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      className={cx('ak-tb', sticky && 'ak-tb--sticky', className)}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        if ((event.target as HTMLElement).matches(ITEM))
          sync([...sync()].indexOf(event.target as HTMLElement));
      }}
    >
      {children}
    </div>
  );
}

export function ToolbarGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <fieldset className="ak-tb-group">
      {label ? <legend className="ak-tb-sr-only">{label}</legend> : null}
      {children}
    </fieldset>
  );
}

export function ToolbarSpacer() {
  return <span className="ak-tb-spacer" aria-hidden="true" />;
}

function tooltip(label: string, shortcut?: string) {
  return shortcut ? `${label} (${shortcut})` : label;
}

export interface ToolbarButtonProps {
  icon?: LucideIcon;
  label: string;
  onClick(): void;
  /** Toggle state (`aria-pressed`). */
  pressed?: boolean;
  disabled?: boolean;
  /** Shown in the tooltip, e.g. "Ctrl+B". */
  shortcut?: string;
  /** Show the text next to the icon (actions that need a word, e.g. "Present"). */
  showLabel?: boolean;
  variant?: 'default' | 'primary' | 'danger';
  /** Keep the editor selection on mouse down (default true). */
  keepFocus?: boolean;
}

export function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  pressed,
  disabled,
  shortcut,
  showLabel,
  variant = 'default',
  keepFocus = true,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      data-ak-tb-item=""
      className={cx('ak-tb-button', (showLabel || !Icon) && 'ak-tb-button--text')}
      data-variant={variant === 'default' ? undefined : variant}
      aria-label={showLabel ? undefined : label}
      title={tooltip(label, shortcut)}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut?.replace(/Ctrl/g, 'Control')}
      disabled={disabled}
      onMouseDown={keepFocus ? keepSelection : undefined}
      onClick={onClick}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      {showLabel || !Icon ? <span>{label}</span> : null}
    </button>
  );
}

export interface ToolbarOption<T extends string> {
  value: T;
  label: string;
}

export interface ToolbarSelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly ToolbarOption<T>[];
  onChange(value: T): void;
  disabled?: boolean;
  /** Fixed width in px for stable layouts. */
  width?: number;
}

export function ToolbarSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  width,
}: ToolbarSelectProps<T>) {
  return (
    <select
      data-ak-tb-item=""
      className="ak-tb-select"
      aria-label={label}
      title={label}
      value={value}
      disabled={disabled}
      style={width ? { width } : undefined}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Popover anchored under a toolbar trigger; closes on Escape, outside click and selection. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  return { open, setOpen, root, trigger, close };
}

function focusItems(container: HTMLElement | null, index: number | 'first' | 'last') {
  const items = [...(container?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])];
  if (items.length === 0) return;
  const target =
    index === 'first' ? 0 : index === 'last' ? items.length - 1 : (index + items.length) % items.length;
  items[target]?.focus();
}

function menuKeys(event: KeyboardEvent<HTMLElement>, close: () => void) {
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])')];
  const current = items.indexOf(document.activeElement as HTMLElement);
  const columns = Number(event.currentTarget.dataset.columns ?? 1);
  const step = {
    ArrowDown: columns,
    ArrowUp: -columns,
    ArrowRight: columns > 1 ? 1 : 0,
    ArrowLeft: columns > 1 ? -1 : 0,
  }[event.key as 'ArrowDown'];
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
  } else if (step) {
    event.preventDefault();
    focusItems(event.currentTarget, current + step);
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    focusItems(event.currentTarget, event.key === 'Home' ? 'first' : 'last');
  }
}

export interface ToolbarMenuItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  onSelect(): void;
  disabled?: boolean;
  /** Checked state for option menus (shows a check mark). */
  checked?: boolean;
  shortcut?: string;
  danger?: boolean;
}

export interface ToolbarMenuProps {
  icon?: LucideIcon;
  label: string;
  items: readonly (ToolbarMenuItem | 'separator')[];
  disabled?: boolean;
  showLabel?: boolean;
  keepFocus?: boolean;
}

export function ToolbarMenu({
  icon: Icon,
  label,
  items,
  disabled,
  showLabel,
  keepFocus = true,
}: ToolbarMenuProps) {
  const { open, setOpen, root, trigger, close } = usePopover();
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (open) focusItems(list.current, 'first');
  }, [open]);
  const hasChecks = items.some((item) => item !== 'separator' && item.checked !== undefined);
  return (
    <span ref={root} className="ak-tb-anchor">
      <button
        ref={trigger}
        type="button"
        data-ak-tb-item=""
        className={cx('ak-tb-button', 'ak-tb-button--menu', (showLabel || !Icon) && 'ak-tb-button--text')}
        aria-label={showLabel ? undefined : label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onMouseDown={keepFocus ? keepSelection : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {Icon ? <Icon aria-hidden="true" /> : null}
        {showLabel || !Icon ? <span>{label}</span> : null}
        <ChevronDown aria-hidden="true" className="ak-tb-caret" />
      </button>
      {open ? (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          className="ak-tb-popover"
          data-ak-tb-popover=""
          onKeyDown={(event) => menuKeys(event, () => close())}
        >
          {items.map((item, index) =>
            item === 'separator' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity.
              <hr key={`sep-${index}`} className="ak-tb-separator" />
            ) : (
              <button
                key={item.key}
                type="button"
                {...(item.checked === undefined
                  ? { role: 'menuitem' }
                  : { role: 'menuitemradio', 'aria-checked': item.checked })}
                tabIndex={-1}
                className="ak-tb-menu-item"
                data-danger={item.danger ? '' : undefined}
                disabled={item.disabled}
                onMouseDown={keepFocus ? keepSelection : undefined}
                onClick={() => {
                  close(!keepFocus);
                  item.onSelect();
                }}
              >
                {hasChecks ? (
                  <span className="ak-tb-check" aria-hidden="true">
                    {item.checked ? <Check /> : null}
                  </span>
                ) : null}
                {item.icon ? <item.icon aria-hidden="true" /> : null}
                <span className="ak-tb-menu-label">{item.label}</span>
                {item.shortcut ? <kbd className="ak-tb-kbd">{item.shortcut}</kbd> : null}
              </button>
            ),
          )}
        </div>
      ) : null}
    </span>
  );
}

export interface ToolbarColorOption {
  /** Theme token or hex. */
  value: string;
  label: string;
  /** Hex used to paint the swatch. */
  swatch: string;
}

/** Swatches for the theme color tokens (labels in pt-BR or English). */
export function themeSwatches(theme: Theme, locale = 'en'): ToolbarColorOption[] {
  const pt = locale.toLowerCase().startsWith('pt');
  const names: Record<ColorToken, [string, string]> = {
    text: ['Text', 'Texto'],
    muted: ['Muted', 'Suave'],
    accent: ['Accent', 'Destaque'],
    background: ['Background', 'Fundo'],
    surface: ['Surface', 'Superfície'],
    info: ['Info', 'Informação'],
    warning: ['Warning', 'Atenção'],
    success: ['Success', 'Sucesso'],
    danger: ['Danger', 'Perigo'],
  };
  return COLOR_TOKENS.map((token) => ({
    value: token,
    label: names[token][pt ? 1 : 0],
    swatch: theme.colors[token],
  }));
}

export interface ToolbarColorProps {
  icon: LucideIcon;
  label: string;
  value?: string | null;
  colors: readonly ToolbarColorOption[];
  onChange(value: string | null): void;
  /** Label of the "no color" option; omitted when not allowed. */
  noneLabel?: string;
  disabled?: boolean;
  keepFocus?: boolean;
}

export function ToolbarColor({
  icon: Icon,
  label,
  value,
  colors,
  onChange,
  noneLabel,
  disabled,
  keepFocus = true,
}: ToolbarColorProps) {
  const { open, setOpen, root, trigger, close } = usePopover();
  const grid = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = colors.find((color) => color.value === value);
  useEffect(() => {
    if (open) focusItems(grid.current, 'first');
  }, [open]);
  return (
    <span ref={root} className="ak-tb-anchor">
      <button
        ref={trigger}
        type="button"
        data-ak-tb-item=""
        className="ak-tb-button ak-tb-button--menu ak-tb-button--color"
        aria-label={`${label}${current ? `: ${current.label}` : ''}`}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onMouseDown={keepFocus ? keepSelection : undefined}
        onClick={() => setOpen(!open)}
      >
        <span className="ak-tb-color-icon">
          <Icon aria-hidden="true" />
          <span className="ak-tb-color-bar" style={{ background: current?.swatch ?? 'transparent' }} />
        </span>
        <ChevronDown aria-hidden="true" className="ak-tb-caret" />
      </button>
      {open ? (
        <div
          ref={grid}
          id={id}
          role="menu"
          aria-label={label}
          className="ak-tb-popover ak-tb-palette"
          data-ak-tb-popover=""
          data-columns="5"
          onKeyDown={(event) => menuKeys(event, () => close())}
        >
          {colors.map((color) => (
            <button
              key={color.value}
              type="button"
              role="menuitemradio"
              aria-checked={color.value === value}
              aria-label={color.label}
              title={color.label}
              tabIndex={-1}
              className="ak-tb-swatch"
              style={{ background: color.swatch }}
              onMouseDown={keepFocus ? keepSelection : undefined}
              onClick={() => {
                close(!keepFocus);
                onChange(color.value);
              }}
            />
          ))}
          {noneLabel ? (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={!value}
              tabIndex={-1}
              className="ak-tb-menu-item ak-tb-palette-none"
              onMouseDown={keepFocus ? keepSelection : undefined}
              onClick={() => {
                close(!keepFocus);
                onChange(null);
              }}
            >
              <X aria-hidden="true" />
              <span className="ak-tb-menu-label">{noneLabel}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}

/** Toolbar styles (Mouts design system); embedded in `artkitCss` and in every kind editor CSS. */
export const toolbarCss = `
.ak-tb{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:6px;background:var(--ak-color-background,#fff);color:var(--ak-color-text,#1d2f3c);border:1px solid var(--ak-color-border,#dde0e2);border-radius:var(--ak-radius-md,8px);font-family:var(--ak-font-body,"Sora",system-ui,sans-serif);font-size:13px;line-height:1}
.ak-tb--sticky{position:sticky;top:0;z-index:5}
.ak-tb-group{display:inline-flex;align-items:center;gap:2px;margin:0;padding:0 0 0 6px;border:0;border-left:1px solid var(--ak-color-border,#dde0e2);min-inline-size:0}
.ak-tb-group:first-child{padding-left:0;border-left:0}
.ak-tb-spacer{flex:1}
.ak-tb-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.ak-tb-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:32px;height:32px;padding:0 6px;border:1px solid transparent;border-radius:var(--ak-radius-sm,6px);background:none;color:var(--ak-color-muted,#56636d);font:inherit;font-weight:600;cursor:pointer;white-space:nowrap;transition:background-color .15s,color .15s,border-color .15s}
.ak-tb-button svg{width:16px;height:16px;flex-shrink:0}
.ak-tb-button--text{padding:0 10px;color:var(--ak-color-text,#1d2f3c)}
.ak-tb-button:hover:not(:disabled){background:var(--ak-color-hover,#f2f3f4);color:var(--ak-color-text,#1d2f3c)}
.ak-tb-button:active:not(:disabled){background:var(--ak-color-active,#e8eaec)}
.ak-tb-button[aria-pressed="true"],.ak-tb-button[aria-expanded="true"]{background:var(--ak-color-fill-accent,#e7f2ef);color:var(--ak-color-accent,#0f7a5a);border-color:var(--ak-color-accent,#0f7a5a)}
.ak-tb-button[data-variant="primary"]{background:var(--ak-gradient-button);color:var(--ak-color-on-primary,#1d2f3c);border-color:transparent}
.ak-tb-button[data-variant="primary"]:hover:not(:disabled){background:var(--ak-gradient-button-hover)}
.ak-tb-button[data-variant="danger"]{color:var(--ak-color-danger,#9f343a)}
.ak-tb-button[data-variant="danger"]:hover:not(:disabled){background:var(--ak-color-fill-danger,#f5ebeb)}
.ak-tb-button:disabled,.ak-tb-select:disabled{opacity:.4;cursor:not-allowed}
.ak-tb-button:focus-visible,.ak-tb-select:focus-visible,.ak-tb-menu-item:focus-visible,.ak-tb-swatch:focus-visible{outline:2px solid var(--ak-color-focus,#0f7a5a);outline-offset:2px}
.ak-tb-button--menu{padding:0 4px 0 6px;gap:2px}
.ak-tb-button--menu.ak-tb-button--text{padding:0 6px 0 10px}
.ak-tb-button .ak-tb-caret{width:12px;height:12px;opacity:.7}
.ak-tb-color-icon{position:relative;display:inline-flex;flex-direction:column;align-items:center;gap:1px}
.ak-tb-color-bar{display:block;width:16px;height:3px;border-radius:2px;border:1px solid var(--ak-color-border,#dde0e2)}
.ak-tb-select{height:32px;max-width:200px;padding:0 8px;font:inherit;font-size:13px;color:var(--ak-color-text,#1d2f3c);background:var(--ak-color-background,#fff);border:1px solid var(--ak-color-border-strong,#8e979d);border-radius:var(--ak-radius-sm,6px);cursor:pointer}
.ak-tb-anchor{position:relative;display:inline-flex}
.ak-tb-popover{position:absolute;top:calc(100% + 4px);left:0;z-index:30;display:flex;flex-direction:column;min-width:200px;max-height:360px;overflow:auto;padding:4px;background:var(--ak-color-background,#fff);border:1px solid var(--ak-color-border-strong,#8e979d);border-radius:var(--ak-radius-md,8px)}
.ak-tb-menu-item{display:flex;align-items:center;gap:8px;width:100%;min-height:32px;padding:0 10px;border:0;border-radius:var(--ak-radius-sm,6px);background:none;color:var(--ak-color-text,#1d2f3c);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.ak-tb-menu-item svg{width:16px;height:16px;flex-shrink:0;color:var(--ak-color-muted,#56636d)}
.ak-tb-menu-item:hover:not(:disabled),.ak-tb-menu-item:focus{background:var(--ak-color-hover,#f2f3f4)}
.ak-tb-menu-item:disabled{opacity:.4;cursor:not-allowed}
.ak-tb-menu-item[data-danger]{color:var(--ak-color-danger,#9f343a)}
.ak-tb-menu-item[aria-checked="true"]{color:var(--ak-color-accent,#0f7a5a);font-weight:600}
.ak-tb-menu-label{flex:1}
.ak-tb-check{display:inline-flex;width:16px}
.ak-tb-check svg{color:var(--ak-color-accent,#0f7a5a)}
.ak-tb-kbd{font-family:var(--ak-font-mono,ui-monospace,monospace);font-size:11px;color:var(--ak-color-muted,#56636d)}
.ak-tb-separator{width:100%;height:1px;margin:4px 0;border:0;background:var(--ak-color-border,#dde0e2)}
.ak-tb-palette{display:grid;grid-template-columns:repeat(5,28px);gap:6px;min-width:0;padding:8px}
.ak-tb-swatch{width:28px;height:28px;padding:0;border:1px solid var(--ak-color-border-strong,#8e979d);border-radius:var(--ak-radius-sm,6px);cursor:pointer}
.ak-tb-swatch[aria-checked="true"]{box-shadow:inset 0 0 0 2px var(--ak-color-background,#fff);border:2px solid var(--ak-color-accent,#0f7a5a)}
.ak-tb-palette-none{grid-column:1/-1}
`;
