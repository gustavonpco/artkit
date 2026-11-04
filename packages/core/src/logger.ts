/** Structured, injectable logger (spec §17). Never log artifact content, cell text, prompts or personal data. */
export interface LogFields {
  artifactId?: string;
  kind?: string;
  version?: number;
  operationCount?: number;
  durationMs?: number;
  code?: string;
  actorType?: string;
  format?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const noop = () => {};

export const silentLogger: Logger = { debug: noop, info: noop, warn: noop, error: noop };

/** Logger writing JSON lines to the console. Opt-in; the default is silent. */
export function createConsoleLogger(minLevel: 'debug' | 'info' | 'warn' | 'error' = 'info'): Logger {
  const levels = ['debug', 'info', 'warn', 'error'] as const;
  const min = levels.indexOf(minLevel);
  const write = (level: (typeof levels)[number]) => (message: string, fields?: LogFields) => {
    if (levels.indexOf(level) < min) return;
    const line = JSON.stringify({ level, message, ...fields });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}

/** Metric hooks (spec §17): durations and rates. Implementations can forward to OpenTelemetry. */
export interface MetricsHooks {
  applyDuration?(ms: number, fields: LogFields): void;
  exportDuration?(ms: number, fields: LogFields): void;
  conflict?(fields: LogFields): void;
  rejection?(code: string, fields: LogFields): void;
}
