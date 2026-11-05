import { File, FileText, type LucideIcon, Presentation, Sheet, Workflow } from 'lucide-react';

/** Lucide icon per native kind; unknown kinds get a generic file. */
export const KIND_ICONS: Record<string, LucideIcon> = {
  document: FileText,
  sheet: Sheet,
  slides: Presentation,
  diagram: Workflow,
};

export function KindIcon({ format, className }: { format: string; className?: string }) {
  const Icon = KIND_ICONS[format] ?? File;
  return <Icon aria-hidden="true" focusable="false" className={className} />;
}
