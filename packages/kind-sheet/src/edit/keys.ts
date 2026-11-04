/** Keyboard handling as pure data: a key event maps to an editor action. */

export interface KeyInput {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export type KeyAction =
  | { type: 'move'; dRow: number; dCol: number; extend: boolean }
  | { type: 'jump'; dRow: number; dCol: number; extend: boolean }
  | { type: 'home'; toStart: boolean; extend: boolean }
  | { type: 'page'; dRow: number; extend: boolean }
  | { type: 'advance'; direction: 'down' | 'up' | 'right' | 'left' }
  | { type: 'edit' }
  | { type: 'type'; text: string }
  | { type: 'clear' }
  | { type: 'select-all' }
  | { type: 'toggle'; style: 'bold' | 'italic' | 'underline' }
  | { type: 'autosum' }
  | { type: 'dropdown' }
  | { type: 'commit'; direction: 'down' | 'up' | 'right' | 'left' }
  | { type: 'cancel' };

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

/** Navigation mode: the grid has focus and no cell is being edited. */
export function navigationKey(event: KeyInput): KeyAction | undefined {
  const mod = event.ctrlKey || event.metaKey;
  const arrow = ARROWS[event.key];
  if (arrow && event.altKey && event.key === 'ArrowDown') return { type: 'dropdown' };
  if (event.altKey && !mod && event.key === '=') return { type: 'autosum' };
  if (arrow) return { type: mod ? 'jump' : 'move', dRow: arrow[0], dCol: arrow[1], extend: event.shiftKey };
  switch (event.key) {
    case 'Enter':
      return { type: 'advance', direction: event.shiftKey ? 'up' : 'down' };
    case 'Tab':
      return { type: 'advance', direction: event.shiftKey ? 'left' : 'right' };
    case 'Home':
      return { type: 'home', toStart: mod, extend: event.shiftKey };
    case 'PageDown':
      return { type: 'page', dRow: 1, extend: event.shiftKey };
    case 'PageUp':
      return { type: 'page', dRow: -1, extend: event.shiftKey };
    case 'F2':
      return { type: 'edit' };
    case 'Delete':
    case 'Backspace':
      return { type: 'clear' };
    default:
      break;
  }
  if (mod && !event.altKey) {
    const lower = event.key.toLowerCase();
    if (lower === 'a') return { type: 'select-all' };
    if (lower === 'b') return { type: 'toggle', style: 'bold' };
    if (lower === 'i') return { type: 'toggle', style: 'italic' };
    if (lower === 'u') return { type: 'toggle', style: 'underline' };
    return undefined;
  }
  // A printable character starts editing with that character, replacing the cell.
  if (event.key.length === 1 && !event.altKey) return { type: 'type', text: event.key };
  return undefined;
}

/** Edit mode: the in-cell input or the formula bar has focus. */
export function editingKey(event: KeyInput): KeyAction | undefined {
  if (event.key === 'Escape') return { type: 'cancel' };
  if (event.key === 'Enter' && !event.altKey)
    return { type: 'commit', direction: event.shiftKey ? 'up' : 'down' };
  if (event.key === 'Tab') return { type: 'commit', direction: event.shiftKey ? 'left' : 'right' };
  return undefined;
}
