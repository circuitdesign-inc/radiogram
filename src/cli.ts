#!/usr/bin/env node
/**
 * radiogram CLI。
 *
 * MCP クライアントを介さずターミナルから無線機を直接操作できるほか、
 * `serve` サブコマンドで MCP サーバー(stdio)としても起動できる。
 * MCP 対応 CLI(Claude Code / Antigravity / Gemini CLI 等)からは
 * このバイナリを `radiogram serve` として登録する。
 *
 * 使い方:
 *   radiogram serve                       MCP サーバーを起動(stdio)
 *   radiogram send "こんにちは"            テキストを送信
 *   radiogram send-binary <base64>        バイナリを送信(base64)
 *   radiogram recv [--timeout 60000]      メッセージを1件受信
 *   radiogram recv-binary [--timeout ...] バイナリを1件受信(base64/hex表示)
 *   radiogram status                      バージョン/チャンネル/モードを表示
 *   radiogram set-channel 15 [--save]     チャンネル設定(7〜46)
 *   radiogram set-mode LoRa [--save]      通信モード設定(FSK|LoRa)
 *   radiogram help                        ヘルプ
 *
 * 共通オプション:
 *   --port, -p <port>    シリアルポート(既定: 環境変数 SERIAL_PORT または OS 既定)
 *   --baud, -b <bps>     ボーレート(既定: 環境変数 BAUD_RATE または 19200)
 *   --timeout, -t <ms>   recv の待機ミリ秒(既定 60000)
 *   --save, -s           set-channel / set-mode を不揮発保存(/W)
 *
 * 注意: シリアルポートは1プロセスしか開けない。MCP サーバー(serve)実行中は
 *       同じポートに対して直接コマンドを実行できない(逆も同様)。
 */
import { SerialManager } from './serial/SerialManager.js';
import { QueueTimeoutError } from './utils/MessageQueue.js';
import { startMcpServer } from './server.js';
import { defaultSerialPort } from './utils/platform.js';
import { MAX_CHANNEL, MIN_CHANNEL, validateChannel, type ModeName } from './serial/protocol.js';

interface ParsedArgs {
  cmd: string;
  positional: string[];
  port: string;
  baud: number;
  timeout: number;
  save: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let port = process.env.SERIAL_PORT ?? defaultSerialPort();
  let baud = Number(process.env.BAUD_RATE ?? 19200);
  let timeout = 60000; // 無線が低速(≈240bps)なので長めの既定。
  let save = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--port':
      case '-p':
        port = args[++i];
        break;
      case '--baud':
      case '-b':
        baud = Number(args[++i]);
        break;
      case '--timeout':
      case '-t':
        timeout = Number(args[++i]);
        break;
      case '--save':
      case '-s':
        save = true;
        break;
      default:
        positional.push(a);
    }
  }

  const cmd = (positional.shift() ?? 'serve').toLowerCase();
  return { cmd, positional, port, baud, timeout, save };
}

const USAGE = `radiogram — MLR-429 無線交信 CLI / MCP サーバー

使い方:
  radiogram serve                     MCP サーバーを起動 (stdio)
  radiogram send "<text>"             テキストを無線送信
  radiogram send-binary <base64>      バイナリを無線送信(base64)
  radiogram recv [-t <ms>]            メッセージを1件受信 (既定 60000ms 待機)
  radiogram recv-binary [-t <ms>]     バイナリを1件受信(base64/hex表示)
  radiogram status                    バージョン/チャンネル/モードを表示
  radiogram set-channel <n> [-s]      チャンネル設定(${MIN_CHANNEL}〜${MAX_CHANNEL}, -s で不揮発保存)
  radiogram set-mode <FSK|LoRa> [-s]  通信モード設定 (-s で不揮発保存)
  radiogram help                      このヘルプ

共通オプション:
  -p, --port <port>    シリアルポート (既定: $SERIAL_PORT または OS 既定)
                       Windows: COM3 / Linux: /dev/ttyUSB0 / macOS: /dev/tty.usbserial
  -b, --baud <bps>     ボーレート (既定: $BAUD_RATE または 19200)
  -t, --timeout <ms>   recv の待機ミリ秒 (既定 60000)
  -s, --save           設定を不揮発メモリに保存 (/W)

例:
  radiogram -p COM44 status                  (Windows)
  radiogram -p /dev/ttyUSB0 send "hello"     (Linux)
  radiogram -p /dev/tty.usbserial recv -t 120000  (macOS)`;

/** シリアルを開いて処理を実行し、確実に閉じる。 */
async function withSerial<T>(
  port: string,
  baud: number,
  fn: (serial: SerialManager) => Promise<T>,
): Promise<T> {
  const serial = new SerialManager({ path: port, baudRate: baud });
  await serial.open();
  try {
    return await fn(serial);
  } finally {
    await serial.close();
  }
}

async function main(): Promise<void> {
  const { cmd, positional, port, baud, timeout, save } = parseArgs(process.argv);

  switch (cmd) {
    case 'serve': {
      // stdout は MCP 専用。ここでは一切 stdout に書かない。
      await startMcpServer({ port, baud });
      return; // サーバーは常駐(SIGINT で終了)。
    }

    case 'send': {
      const text = positional.join(' ');
      if (!text) throw new Error('送信テキストを指定してください: radiogram send "..."');
      await withSerial(port, baud, (s) => s.transmit(text));
      console.log(`送信完了: "${text}"`);
      break;
    }

    case 'send-binary':
    case 'sendbinary': {
      const base64 = positional[0];
      if (!base64) throw new Error('base64 データを指定してください: radiogram send-binary <base64>');
      const data = Buffer.from(base64, 'base64');
      if (data.toString('base64').replace(/=+$/, '') !== base64.replace(/=+$/, '')) {
        throw new Error('有効な base64 データを指定してください');
      }
      await withSerial(port, baud, (s) => s.transmitBytes(data));
      console.log(`バイナリ送信完了: ${data.length} バイト`);
      break;
    }

    case 'recv':
    case 'receive': {
      try {
        const msg = await withSerial(port, baud, (s) =>
          s.rfReceiveQueue.dequeue(timeout),
        );
        console.log(msg);
      } catch (err) {
        if (err instanceof QueueTimeoutError) {
          console.error('(受信メッセージなし: タイムアウト)');
          process.exitCode = 2;
          return;
        }
        throw err;
      }
      break;
    }

    case 'recv-binary':
    case 'receive-binary':
    case 'recvbinary': {
      try {
        const data = await withSerial(port, baud, (s) =>
          s.rfReceiveBytesQueue.dequeue(timeout),
        );
        console.log(`base64: ${data.toString('base64')}`);
        console.log(`hex:    ${data.toString('hex')}`);
        console.log(`length: ${data.length}`);
      } catch (err) {
        if (err instanceof QueueTimeoutError) {
          console.error('(受信メッセージなし: タイムアウト)');
          process.exitCode = 2;
          return;
        }
        throw err;
      }
      break;
    }

    case 'status': {
      const st = await withSerial(port, baud, (s) => s.getStatus());
      console.log(`バージョン: ${st.version}`);
      console.log(`チャンネル: ${st.channel} (0x${st.channel.toString(16).toUpperCase()})`);
      console.log(`モード:     ${st.modeName} (0x${st.mode.toString(16).toUpperCase().padStart(2, '0')})`);
      break;
    }

    case 'set-channel':
    case 'setchannel': {
      const ch = Number(positional[0]);
      try {
        validateChannel(ch);
      } catch {
        throw new Error(`チャンネル番号を ${MIN_CHANNEL}〜${MAX_CHANNEL} の範囲で指定してください: radiogram set-channel <n>`);
      }
      const result = await withSerial(port, baud, (s) => s.setChannel(ch, save));
      console.log(`チャンネルを ${result} に設定しました${save ? ' (保存済み)' : ''}`);
      break;
    }

    case 'set-mode':
    case 'setmode': {
      const raw = (positional[0] ?? '').toLowerCase();
      const mode: ModeName | null = raw === 'fsk' ? 'FSK' : raw === 'lora' ? 'LoRa' : null;
      if (!mode) throw new Error('モードを指定してください: radiogram set-mode <FSK|LoRa>');
      const result = await withSerial(port, baud, (s) => s.setMode(mode, save));
      const name = result === 0x01 ? 'FSK' : result === 0x03 ? 'LoRa' : `0x${result.toString(16)}`;
      console.log(`通信モードを ${name} に設定しました${save ? ' (保存済み)' : ''}`);
      break;
    }

    case 'help':
    case '--help':
    case '-h': {
      console.log(USAGE);
      break;
    }

    default: {
      console.error(`未知のサブコマンド: ${cmd}\n`);
      console.error(USAGE);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error('エラー:', (err as Error).message);
  process.exit(1);
});
