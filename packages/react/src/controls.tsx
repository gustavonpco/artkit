import { COLOR_TOKENS, type Color, isColorToken, resolveColor, type Theme } from '@artkit-ai/core';
import type { LucideIcon } from 'lucide-react';
import {
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from 'react';

/*
 * Standard form controls for kind editors and side panels (Mouts design: 32px controls, 6px radius, accent
 * pressed state, focus ring). Every kind uses these, so buttons, fields, selects, switches and property
 * panels look the same in documents, sheets, slides and diagrams, in light and dark themes.
 */

const pt = (locale: string | undefined) => (locale ?? '').toLowerCase().startsWith('pt');

export type ControlVariant = 'default' | 'primary' | 'quiet' | 'danger';
export type ControlSize = 'sm' | 'md';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  icon?: LucideIcon;
  variant?: ControlVariant;
  size?: ControlSize;
  /** Toggle state (`aria-pressed`). */
  pressed?: boolean;
  type?: 'button' | 'submit';
}

export function Button({
  icon: Icon,
  variant = 'default',
  size = 'md',
  pressed,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button
      type={type}
      className={`ak-ctl-button${className ? ` ${className}` : ''}`}
      data-variant={variant === 'default' ? undefined : variant}
      data-size={size === 'md' ? undefined : size}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      {...rest}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'children' | 'aria-label'> {
  icon: LucideIcon;
  label: string;
}

/** Square icon-only button; the label becomes the accessible name and tooltip. */
export function IconButton({ icon, label, title, ...rest }: IconButtonProps): ReactElement {
  return <Button icon={icon} aria-label={label} title={title ?? label} data-icon-only="" {...rest} />;
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

/** Label above a control (and an optional hint below it). */
export function Field({ label, hint, htmlFor, children, className }: FieldProps): ReactElement {
  return (
    <div className={`ak-ctl-field${className ? ` ${className}` : ''}`}>
      <label className="ak-ctl-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <span className="ak-ctl-hint">{hint}</span> : null}
    </div>
  );
}

/** Fields side by side, wrapping on narrow panels. */
export function FieldRow({ children, label }: { children: ReactNode; label?: string }): ReactElement {
  return (
    <div className="ak-ctl-row" {...(label ? { role: 'group', 'aria-label': label } : {})}>
      {children}
    </div>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onCommit(value: string): void;
  multiline?: boolean;
  disabled?: boolean;
  placeholder?: string;
  hint?: ReactNode;
  rows?: number;
}

/** Text input that commits on blur (or Enter for single-line fields), not on every keystroke. */
export function TextField({
  label,
  value,
  onCommit,
  multiline,
  disabled,
  placeholder,
  hint,
  rows = 4,
}: TextFieldProps): ReactElement {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      {multiline ? (
        <textarea
          id={id}
          className="ak-ctl-textarea"
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          rows={rows}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          id={id}
          className="ak-ctl-input"
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
        />
      )}
    </Field>
  );
}

export interface NumberFieldProps {
  label: string;
  value: number | undefined;
  onCommit(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
  /** Unit shown after the value (e.g. "in", "pt", "%"). */
  unit?: string;
}

/** Number input that commits on blur or Enter, clamped to min/max. */
export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 0.01,
  disabled,
  placeholder,
  unit,
}: NumberFieldProps): ReactElement {
  const id = useId();
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  useEffect(() => setDraft(value === undefined ? '' : String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(value === undefined ? '' : String(value));
      return;
    }
    const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, parsed));
    if (clamped !== value) onCommit(clamped);
    setDraft(String(clamped));
  };
  const input = (
    <input
      id={id}
      className="ak-ctl-input"
      type="number"
      inputMode="decimal"
      value={draft}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
    />
  );
  return (
    <Field label={label} htmlFor={id}>
      {unit ? (
        <span className="ak-ctl-affix">
          {input}
          <span className="ak-ctl-unit" aria-hidden="true">
            {unit}
          </span>
        </span>
      ) : (
        input
      )}
    </Field>
  );
}

export interface SelectFieldProps<T extends string> {
  label: string;
  value: T | undefined;
  options: readonly { value: T; label: string }[];
  onChange(value: T): void;
  disabled?: boolean;
  hint?: ReactNode;
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  hint,
}: SelectFieldProps<T>): ReactElement {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <select
        id={id}
        className="ak-ctl-select"
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {value === undefined ? <option value="">—</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export interface SwitchProps {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
}

/** On/off switch (`role="switch"`) with its label beside it. */
export function Switch({ label, checked, onChange, disabled }: SwitchProps): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="ak-ctl-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="ak-ctl-switch-track" aria-hidden="true">
        <span className="ak-ctl-switch-thumb" />
      </span>
      <span className="ak-ctl-switch-label">{label}</span>
    </button>
  );
}

export interface ToggleProps {
  label: string;
  pressed: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
  /** Button content (e.g. an icon or "B"); without it the toggle is drawn as a switch. */
  children?: ReactNode;
  icon?: LucideIcon;
}

/** Pressed-state button (formatting toggles) or, without content, a labelled switch. */
export function Toggle({ label, pressed, onChange, disabled, children, icon }: ToggleProps): ReactElement {
  if (children === undefined && icon === undefined)
    return <Switch label={label} checked={pressed} onChange={onChange} {...(disabled ? { disabled } : {})} />;
  return (
    <Button
      size="sm"
      pressed={pressed}
      aria-label={label}
      title={label}
      disabled={disabled}
      data-icon-only=""
      {...(icon ? { icon } : {})}
      onClick={() => onChange(!pressed)}
    >
      {children}
    </Button>
  );
}

export interface SegmentedProps<T extends string> {
  label: string;
  value: T | undefined;
  options: readonly { value: T; label: string; icon?: LucideIcon }[];
  onChange(value: T): void;
  disabled?: boolean;
}

/** Small set of mutually exclusive options shown as joined buttons. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: SegmentedProps<T>): ReactElement {
  return (
    <div className="ak-ctl-segmented" role="radiogroup" aria-label={label}>
      {options.map(({ value: option, label: text, icon: Icon }) => (
        // biome-ignore lint/a11y/useSemanticElements: segmented buttons are styled radio buttons.
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          aria-label={Icon ? text : undefined}
          title={text}
          disabled={disabled}
          onClick={() => onChange(option)}
        >
          {Icon ? <Icon aria-hidden="true" /> : text}
        </button>
      ))}
    </div>
  );
}

export interface ColorPickerProps {
  label: string;
  value: Color | undefined;
  theme: Theme;
  locale: string;
  onChange(color: Color | undefined): void;
  /** Offer a hex input besides the theme tokens. */
  allowHex?: boolean;
  /** Offer a "none" option (for optional fills). */
  allowNone?: boolean;
  disabled?: boolean;
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Theme token swatches with an optional hex field. */
export function ColorPicker({
  label,
  value,
  theme,
  locale,
  onChange,
  allowHex,
  allowNone,
  disabled,
}: ColorPickerProps): ReactElement {
  const [hex, setHex] = useState(value && !isColorToken(value) ? value : '');
  useEffect(() => setHex(value && !isColorToken(value) ? value : ''), [value]);
  const none = pt(locale) ? 'Nenhuma' : 'None';
  return (
    <fieldset className="ak-ctl-colors" disabled={disabled}>
      <legend className="ak-ctl-label">{label}</legend>
      <div className="ak-ctl-swatches">
        {allowNone ? (
          <button
            type="button"
            aria-pressed={value === undefined}
            className="ak-ctl-swatch ak-ctl-swatch-none"
            aria-label={none}
            title={none}
            onClick={() => onChange(undefined)}
          />
        ) : null}
        {COLOR_TOKENS.map((token) => (
          <button
            key={token}
            type="button"
            aria-pressed={value === token}
            className="ak-ctl-swatch"
            style={{ background: resolveColor(theme, token) }}
            aria-label={token}
            title={token}
            onClick={() => onChange(token)}
          />
        ))}
      </div>
      {allowHex ? (
        <span className="ak-ctl-affix ak-ctl-hex">
          <span
            className="ak-ctl-hex-preview"
            aria-hidden="true"
            style={HEX.test(hex) ? { background: hex } : undefined}
          />
          <input
            className="ak-ctl-input"
            data-size="sm"
            aria-label={`${label} (hex)`}
            placeholder="#RRGGBB"
            value={hex}
            onChange={(event) => setHex(event.target.value)}
            onBlur={() => {
              if (HEX.test(hex) && hex !== value) onChange(hex);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && HEX.test(hex)) onChange(hex);
            }}
          />
        </span>
      ) : null}
    </fieldset>
  );
}

export interface InspectorProps {
  label: string;
  children: ReactNode;
  className?: string;
}

/** Side properties panel of an editor: stacked sections separated by rules. */
export function Inspector({ label, children, className }: InspectorProps): ReactElement {
  return (
    <aside className={`ak-ctl-inspector${className ? ` ${className}` : ''}`} aria-label={label}>
      {children}
    </aside>
  );
}

export interface InspectorSectionProps {
  title?: ReactNode;
  /** Accessible name when the title is not plain text. */
  label?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function InspectorSection({
  title,
  label,
  actions,
  children,
  className,
}: InspectorSectionProps): ReactElement {
  const ariaLabel = label ?? (typeof title === 'string' ? title : undefined);
  return (
    <section
      className={`ak-ctl-section${className ? ` ${className}` : ''}`}
      {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
    >
      {title || actions ? (
        <header className="ak-ctl-section-head">
          {title ? <h3 className="ak-ctl-section-title">{title}</h3> : null}
          {actions ? <div className="ak-ctl-section-actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** Wrapping row of buttons. */
export function ButtonRow({ children, label }: { children: ReactNode; label?: string }): ReactElement {
  return (
    <div className="ak-ctl-buttons" {...(label ? { role: 'group', 'aria-label': label } : {})}>
      {children}
    </div>
  );
}

/** Muted helper text for empty states and instructions. */
export function Hint({ children }: { children: ReactNode }): ReactElement {
  return <p className="ak-ctl-empty">{children}</p>;
}

const BUTTON =
  'display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;margin:0;font:inherit;font-size:13px;font-weight:600;line-height:1;white-space:nowrap;border:1px solid var(--ak-color-border,#dde0e2);border-radius:var(--ak-radius-sm,6px);background:var(--ak-color-background,#fff);color:var(--ak-color-text,#1d2f3c);cursor:pointer;transition:background-color .15s,border-color .15s,color .15s,box-shadow .15s';
const FIELD =
  'box-sizing:border-box;width:100%;min-width:0;height:32px;margin:0;padding:0 10px;font:inherit;font-size:13px;line-height:1.3;color:var(--ak-color-text,#1d2f3c);background:var(--ak-color-background,#fff);border:1px solid var(--ak-color-border-strong,#8e979d);border-radius:var(--ak-radius-sm,6px);transition:border-color .15s,box-shadow .15s';

/**
 * Plain `<button>`, `<input>`, `<select>` and `<textarea>` without a class inside `.ak-ctl-scope` get the
 * standard look too (zero specificity, so any kind class still wins).
 */
const SCOPE = ':where(.ak-ctl-scope)';
const PLAIN_BUTTON = `${SCOPE} :where(button:not([class]))`;
const PLAIN_FIELD = `${SCOPE} :where(input:not([class]):not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="range"]):not([type="file"]),select:not([class]),textarea:not([class]))`;

export const controlsCss = `
.ak-ctl-button,${PLAIN_BUTTON}{${BUTTON}}
.ak-ctl-button svg,${PLAIN_BUTTON} svg{width:16px;height:16px;flex-shrink:0}
.ak-ctl-button:hover:not(:disabled),${PLAIN_BUTTON}:hover:not(:disabled){background:var(--ak-color-hover,#f2f3f4);border-color:var(--ak-color-border-strong,#8e979d)}
.ak-ctl-button:active:not(:disabled),${PLAIN_BUTTON}:active:not(:disabled){background:var(--ak-color-active,#e8eaec)}
.ak-ctl-button[aria-pressed="true"],${PLAIN_BUTTON}[aria-pressed="true"]{background:var(--ak-color-fill-accent,#e7f2ef);color:var(--ak-color-accent,#0f7a5a);border-color:var(--ak-color-accent,#0f7a5a)}
.ak-ctl-button:disabled,${PLAIN_BUTTON}:disabled{opacity:.4;cursor:not-allowed}
.ak-ctl-button:focus-visible,${PLAIN_BUTTON}:focus-visible,.ak-ctl-switch:focus-visible,.ak-ctl-swatch:focus-visible,.ak-ctl-segmented button:focus-visible{outline:2px solid var(--ak-color-focus,#0f7a5a);outline-offset:2px}
.ak-ctl-button[data-size="sm"]{height:28px;padding:0 10px;font-size:12px}
.ak-ctl-button[data-size="sm"] svg{width:14px;height:14px}
.ak-ctl-button[data-icon-only]{width:32px;padding:0}
.ak-ctl-button[data-icon-only][data-size="sm"]{width:28px}
.ak-ctl-button[data-variant="primary"]{border-color:transparent;background:var(--ak-gradient-button,#00dd80);color:var(--ak-color-on-primary,#1d2f3c)}
.ak-ctl-button[data-variant="primary"]:hover:not(:disabled){border-color:transparent;background:var(--ak-gradient-button-hover,#16a683)}
.ak-ctl-button[data-variant="quiet"]{border-color:transparent;background:transparent;color:var(--ak-color-muted,#56636d)}
.ak-ctl-button[data-variant="quiet"]:hover:not(:disabled){border-color:transparent;color:var(--ak-color-text,#1d2f3c)}
.ak-ctl-button[data-variant="quiet"][aria-pressed="true"]{border-color:var(--ak-color-accent,#0f7a5a);color:var(--ak-color-accent,#0f7a5a)}
.ak-ctl-button[data-variant="danger"]{color:var(--ak-color-danger,#9f343a)}
.ak-ctl-button[data-variant="danger"]:hover:not(:disabled){background:var(--ak-color-fill-danger,#f5ebeb);border-color:var(--ak-color-danger,#9f343a)}
.ak-ctl-input,.ak-ctl-select,.ak-ctl-textarea,${PLAIN_FIELD}{${FIELD}}
.ak-ctl-input:hover:not(:disabled),.ak-ctl-select:hover:not(:disabled),.ak-ctl-textarea:hover:not(:disabled),${PLAIN_FIELD}:hover:not(:disabled){border-color:var(--ak-color-muted,#56636d)}
.ak-ctl-input:focus,.ak-ctl-select:focus,.ak-ctl-textarea:focus,${PLAIN_FIELD}:focus{outline:none;border-color:var(--ak-color-accent,#0f7a5a);box-shadow:0 0 0 1px var(--ak-color-accent,#0f7a5a)}
.ak-ctl-input:disabled,.ak-ctl-select:disabled,.ak-ctl-textarea:disabled,${PLAIN_FIELD}:disabled{opacity:.5;cursor:not-allowed}
.ak-ctl-input::placeholder,.ak-ctl-textarea::placeholder{color:var(--ak-color-muted,#56636d);opacity:.8}
.ak-ctl-select,${SCOPE} :where(select:not([class])){cursor:pointer;padding-right:6px}
.ak-ctl-textarea,${SCOPE} :where(textarea:not([class])){height:auto;min-height:72px;padding:8px 10px;line-height:1.5;resize:vertical}
.ak-ctl-input[data-size="sm"],.ak-ctl-select[data-size="sm"]{height:28px;font-size:12px;padding:0 8px}
.ak-ctl-field{display:flex;flex-direction:column;gap:4px;min-width:0;margin:0}
.ak-ctl-label{display:block;padding:0;font-size:12px;font-weight:600;line-height:16px;color:var(--ak-color-muted,#56636d)}
.ak-ctl-hint{font-size:12px;line-height:16px;color:var(--ak-color-muted,#56636d)}
.ak-ctl-row{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}
.ak-ctl-row>.ak-ctl-field{flex:1 1 64px}
.ak-ctl-buttons{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0;padding:0;border:0;min-inline-size:0}
.ak-ctl-affix{position:relative;display:flex;align-items:center;min-width:0}
.ak-ctl-affix .ak-ctl-input{padding-right:30px}
.ak-ctl-unit{position:absolute;right:8px;font-size:12px;color:var(--ak-color-muted,#56636d);pointer-events:none}
.ak-ctl-hex{max-width:160px}
.ak-ctl-hex .ak-ctl-input{padding-left:30px;padding-right:8px;font-family:var(--ak-font-mono,ui-monospace,monospace)}
.ak-ctl-hex-preview{position:absolute;left:7px;width:16px;height:16px;border-radius:4px;border:1px solid var(--ak-color-border-strong,#8e979d);background:repeating-conic-gradient(var(--ak-color-border,#dde0e2) 0 25%,transparent 0 50%) 50%/8px 8px}
.ak-ctl-colors{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;border:0;min-inline-size:0}
.ak-ctl-colors:disabled{opacity:.5}
.ak-ctl-swatches{display:flex;flex-wrap:wrap;gap:6px}
.ak-ctl-swatch{width:24px;height:24px;min-width:0;padding:0;border:1px solid var(--ak-color-border-strong,#8e979d);border-radius:var(--ak-radius-sm,6px);cursor:pointer;transition:transform .1s}
.ak-ctl-swatch:hover:not(:disabled){transform:scale(1.08)}
.ak-ctl-swatch[aria-pressed="true"]{border:2px solid var(--ak-color-accent,#0f7a5a);box-shadow:inset 0 0 0 2px var(--ak-color-background,#fff)}
.ak-ctl-swatch-none{background:linear-gradient(135deg,transparent 44%,var(--ak-color-danger,#9f343a) 44%,var(--ak-color-danger,#9f343a) 56%,transparent 56%),var(--ak-color-background,#fff)}
.ak-ctl-switch{display:inline-flex;align-items:center;gap:10px;min-height:28px;margin:0;padding:0;border:0;background:none;color:var(--ak-color-text,#1d2f3c);font:inherit;font-size:13px;font-weight:600;text-align:left;cursor:pointer;border-radius:var(--ak-radius-sm,6px)}
.ak-ctl-switch:disabled{opacity:.4;cursor:not-allowed}
.ak-ctl-switch-track{position:relative;flex-shrink:0;width:32px;height:18px;border-radius:999px;background:var(--ak-color-border-strong,#8e979d);transition:background-color .15s}
.ak-ctl-switch-thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--ak-color-background,#fff);transition:transform .15s}
.ak-ctl-switch[aria-checked="true"] .ak-ctl-switch-track{background:var(--ak-color-primary-deep,#16a683)}
.ak-ctl-switch[aria-checked="true"] .ak-ctl-switch-thumb{transform:translateX(14px)}
.ak-ctl-segmented{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--ak-color-border,#dde0e2);border-radius:var(--ak-radius-sm,6px);background:var(--ak-color-surface,#f4f7f7)}
.ak-ctl-segmented button{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-width:28px;height:26px;padding:0 8px;border:0;border-radius:4px;background:transparent;color:var(--ak-color-muted,#56636d);font:inherit;font-size:12px;font-weight:600;cursor:pointer}
.ak-ctl-segmented button svg{width:14px;height:14px}
.ak-ctl-segmented button:hover:not(:disabled){color:var(--ak-color-text,#1d2f3c)}
.ak-ctl-segmented button[aria-checked="true"]{background:var(--ak-color-background,#fff);color:var(--ak-color-accent,#0f7a5a);box-shadow:0 0 0 1px var(--ak-color-border,#dde0e2)}
.ak-ctl-inspector{display:flex;flex-direction:column;min-width:0;max-height:80vh;overflow-y:auto;background:var(--ak-color-background,#fff);color:var(--ak-color-text,#1d2f3c);border:1px solid var(--ak-color-border,#dde0e2);border-radius:var(--ak-radius-md,8px);font-size:13px}
.ak-ctl-section{display:flex;flex-direction:column;gap:12px;margin:0;padding:14px;border:0;border-top:1px solid var(--ak-color-border,#dde0e2)}
.ak-ctl-section:first-child{border-top:0}
.ak-ctl-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:20px}
.ak-ctl-section-title{margin:0;font-family:var(--ak-font-heading,"Sora",system-ui,sans-serif);font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ak-color-text,#1d2f3c)}
.ak-ctl-section-actions{display:flex;gap:4px}
.ak-ctl-empty{margin:0;font-size:13px;line-height:1.55;color:var(--ak-color-muted,#56636d)}
.ak-ctl-card{display:flex;flex-direction:column;gap:8px;margin:0;padding:10px;border:1px solid var(--ak-color-border,#dde0e2);border-radius:var(--ak-radius-md,8px);background:var(--ak-color-surface,#f4f7f7);min-inline-size:0}
.ak-ctl-list{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.ak-ctl-list-item{display:flex;align-items:center;gap:8px;width:100%;min-height:32px;padding:0 10px;border:1px solid transparent;border-radius:var(--ak-radius-sm,6px);background:none;color:var(--ak-color-text,#1d2f3c);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.ak-ctl-list-item:hover:not(:disabled){background:var(--ak-color-hover,#f2f3f4)}
.ak-ctl-list-item[aria-current="true"]{background:var(--ak-color-fill-accent,#e7f2ef);border-color:var(--ak-color-accent,#0f7a5a);color:var(--ak-color-accent,#0f7a5a)}
`;
