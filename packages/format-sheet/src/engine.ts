import type { WorkbookContent } from './model.js';
import type { ResolvedOperation } from './operations.js';

/**
 * Executes resolved operations on a workbook and returns the new snapshot with its computed values (spec §11.1).
 * The default engine runs Univer headless on the server (`@artkit-ai/format-sheet/server`). Implementations must be
 * deterministic: no clock, network or randomness during execution.
 */
export interface SheetEngine {
  execute(
    content: WorkbookContent,
    operations: ResolvedOperation[],
    options: { locale: string; timeoutMs?: number },
  ): Promise<WorkbookContent>;
}
