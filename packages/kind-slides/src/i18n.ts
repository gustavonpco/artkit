/** Model- and user-facing text ships in English and Portuguese; pick by locale. */
export function isPt(locale: string | undefined): boolean {
  return locale?.toLowerCase().startsWith('pt') ?? false;
}

export function tr(locale: string | undefined, en: string, pt: string): string {
  return isPt(locale) ? pt : en;
}
