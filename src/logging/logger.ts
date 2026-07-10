export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogFields {
  [key: string]: unknown;
}

export interface LoggerOptions {
  level?: LogLevel;
  json?: boolean;
  command?: string;
  sink?: (line: string) => void;
}

/**
 * Structured logger shared by every command. Supports plain human-readable
 * lines (default) and a machine-parseable JSON-lines mode for CI consumption
 * (task 1.7).
 */
export class Logger {
  private readonly level: LogLevel;
  private readonly json: boolean;
  private readonly command: string | undefined;
  private readonly sink: (line: string) => void;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? envLevel() ?? 'info';
    this.json = options.json ?? process.env.DOCWELDER_LOG_JSON === '1';
    this.command = options.command;
    this.sink = options.sink ?? ((line) => process.stderr.write(line + '\n'));
  }

  child(command: string): Logger {
    return new Logger({ level: this.level, json: this.json, command, sink: this.sink });
  }

  debug(message: string, fields?: LogFields): void {
    this.emit('debug', message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.emit('info', message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.emit('warn', message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.emit('error', message, fields);
  }

  private emit(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    if (this.json) {
      this.sink(
        JSON.stringify({
          ts: new Date().toISOString(),
          level,
          command: this.command,
          message,
          ...fields,
        }),
      );
      return;
    }
    const prefix = this.command ? `[${this.command}] ${level.toUpperCase()}` : level.toUpperCase();
    const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : '';
    this.sink(`${prefix}: ${message}${suffix}`);
  }
}

function envLevel(): LogLevel | undefined {
  const raw = process.env.DOCWELDER_LOG_LEVEL;
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return undefined;
}

export const rootLogger = new Logger();
