export interface LoggerLike {
  debug(message: string, meta?: unknown): void;
  log(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export class Logger implements LoggerLike {
  public constructor(private readonly context: string) {}

  public debug(message: string, meta?: unknown): void {
    this.write('debug', message, meta);
  }

  public log(message: string, meta?: unknown): void {
    this.write('info', message, meta);
  }

  public warn(message: string, meta?: unknown): void {
    this.write('warn', message, meta);
  }

  public error(message: string, meta?: unknown): void {
    this.write('error', message, meta);
  }

  private write(level: string, message: string, meta?: unknown): void {
    const prefix = `[${new Date().toISOString()}] ${level.toUpperCase()} ${this.context}:`;
    if (meta === undefined) {
      // eslint-disable-next-line no-console
      console.log(prefix, message);
      return;
    }
    // eslint-disable-next-line no-console
    console.log(prefix, message, meta);
  }
}
