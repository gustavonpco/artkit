import { controlsCss } from './controls.js';
import { toolbarCss } from './toolbar.js';

/** Toolbar and form control styles shared by every kind editor and viewer (include once per kind CSS). */
export const kitCss = `${toolbarCss}${controlsCss}`;
