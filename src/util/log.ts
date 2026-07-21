const PREFIX = '[gltf2tiles]';

export enum LogLevel {
  Silent = 0,
  Error = 1,
  Warn = 2,
  Info = 3,
  Debug = 4,
}

let _level = LogLevel.Info;

export function setLogLevel(level: LogLevel): void {
  _level = level;
}

export function getLogLevel(): LogLevel {
  return _level;
}

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

export function error(msg: string, ...args: unknown[]): void {
  if (_level >= LogLevel.Error) console.error(`${PREFIX} ${ts()} ERROR: ${msg}`, ...args);
}

export function warn(msg: string, ...args: unknown[]): void {
  if (_level >= LogLevel.Warn) console.warn(`${PREFIX} ${ts()} WARN:  ${msg}`, ...args);
}

export function info(msg: string, ...args: unknown[]): void {
  if (_level >= LogLevel.Info) console.log(`${PREFIX} ${ts()} INFO:  ${msg}`, ...args);
}

export function debug(msg: string, ...args: unknown[]): void {
  if (_level >= LogLevel.Debug) console.log(`${PREFIX} ${ts()} DEBUG: ${msg}`, ...args);
}
