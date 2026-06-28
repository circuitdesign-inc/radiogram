/**
 * ログ出力ユーティリティ。
 *
 * 重要: MCP は stdout を JSON-RPC 専用に使うため、ログは必ず stderr に出す。
 *        stdout に書くとプロトコルが壊れる。
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// LOG_LEVEL 環境変数で閾値を制御(既定 info)。
const threshold = (process.env.LOG_LEVEL as Level) ?? 'info';

function emit(level: Level, args: unknown[]): void {
  if (LEVEL_ORDER[level] < (LEVEL_ORDER[threshold] ?? LEVEL_ORDER.info)) {
    return;
  }
  const prefix = `[radiogram ${level}]`;
  // すべて stderr へ。
  process.stderr.write(
    prefix + ' ' + args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n',
  );
}

export const logger = {
  debug: (...args: unknown[]): void => emit('debug', args),
  info: (...args: unknown[]): void => emit('info', args),
  warn: (...args: unknown[]): void => emit('warn', args),
  error: (...args: unknown[]): void => emit('error', args),
};
