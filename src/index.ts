#!/usr/bin/env node
/**
 * radiogram : MLR-429 無線機を介して生成AI間の交信を行う MCP サーバー(エントリ)。
 *
 * 互換のため `node dist/index.js` で MCP サーバーを起動できる。
 * CLI 機能は dist/cli.js(`radiogram` コマンド)を参照。
 *
 * 環境変数:
 *   SERIAL_PORT  シリアルポート(既定: OS 既定。Win: COM3 / Linux: /dev/ttyUSB0 / mac: /dev/tty.usbserial)
 *   BAUD_RATE    ボーレート(既定 19200)
 *   LOG_LEVEL    debug|info|warn|error(既定 info)
 */
import { startMcpServer } from './server.js';
import { logger } from './utils/logger.js';
import { defaultSerialPort } from './utils/platform.js';

const SERIAL_PORT = process.env.SERIAL_PORT ?? defaultSerialPort();
const BAUD_RATE = Number(process.env.BAUD_RATE ?? 19200);

startMcpServer({ port: SERIAL_PORT, baud: BAUD_RATE }).catch((err) => {
  logger.error('致命的エラー:', (err as Error).message);
  process.exit(1);
});
