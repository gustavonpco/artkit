/** True for Portuguese locales; everything else uses English. */
export function isPt(locale: string | undefined): boolean {
  return locale?.toLowerCase().startsWith('pt') ?? false;
}

/** Picks the English or Portuguese variant of a message. */
export function msg(locale: string | undefined, en: string, pt: string): string {
  return isPt(locale) ? pt : en;
}

/** Quotes a label for the projection, escaping embedded quotes and backslashes. */
export function quote(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s+/g, ' ')}"`;
}
