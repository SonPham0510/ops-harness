export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  child: (bindings: LogFields) => Logger;
  debug: (fieldsOrMessage: LogFields | string, message?: string) => void;
  error: (fieldsOrMessage: LogFields | string, message?: string) => void;
  info: (fieldsOrMessage: LogFields | string, message?: string) => void;
  warn: (fieldsOrMessage: LogFields | string, message?: string) => void;
}

interface LoggerOptions {
  bindings?: LogFields;
  format?: "json" | "pretty";
  level?: LogLevel;
  sink?: { write: (line: string) => void };
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  error: 40,
  info: 20,
  warn: 30,
};

export const createLogger = (options: LoggerOptions = {}): Logger => {
  const level = options.level ?? readLevel(process.env.OPS_AGENT_LOG_LEVEL);
  const format = options.format ?? readFormat(process.env.OPS_AGENT_LOG_FORMAT);
  const sink = options.sink ?? {
    write: (line: string) => process.stderr.write(`${line}\n`),
  };
  const bindings = options.bindings ?? {};
  const write = (
    recordLevel: LogLevel,
    fieldsOrMessage: LogFields | string,
    message?: string
  ): void => {
    if (LEVEL_ORDER[recordLevel] < LEVEL_ORDER[level]) {
      return;
    }
    const fields = typeof fieldsOrMessage === "string" ? {} : fieldsOrMessage;
    const recordMessage =
      typeof fieldsOrMessage === "string" ? fieldsOrMessage : message;
    const record = {
      ...bindings,
      ...fields,
      level: recordLevel,
      ...(recordMessage === undefined ? {} : { message: recordMessage }),
      time: new Date().toISOString(),
    };
    const line =
      format === "pretty"
        ? `${recordLevel.toUpperCase()} ${recordMessage ?? ""} ${JSON.stringify({ ...bindings, ...fields })}`.trim()
        : JSON.stringify(record);
    sink.write(line);
  };
  return {
    child: (childBindings) =>
      createLogger({
        bindings: { ...bindings, ...childBindings },
        format,
        level,
        sink,
      }),
    debug: (fields, message) => write("debug", fields, message),
    error: (fields, message) => write("error", fields, message),
    info: (fields, message) => write("info", fields, message),
    warn: (fields, message) => write("warn", fields, message),
  };
};

const readLevel = (value: string | undefined): LogLevel =>
  value === "debug" || value === "warn" || value === "error" ? value : "info";

const readFormat = (value: string | undefined): "json" | "pretty" =>
  value === "pretty" ? "pretty" : "json";
