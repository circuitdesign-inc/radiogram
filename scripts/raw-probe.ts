/**
 * 低レベル診断: ReadlineParser を介さず生バイトを観測する。
 *
 * - 指定ポートを開き、DTR/RTS を明示的に立て、生 RX を hex+ascii でダンプ。
 * - 開いて少し待ってから @VR\r\n を送り、応答が来るか観測。
 * - BAUD_SCAN=1 で代表的なボーレートを順に試し、応答が得られる速度を探す。
 *
 * 使い方 (ポートは OS に合わせて: Win COMx / Linux /dev/ttyUSBx / macOS /dev/tty.usbserial-*):
 *   PORT=/dev/ttyUSB0 npm run probe
 *   PORT=/dev/ttyUSB0 BAUD=19200 npm run probe
 *   PORT=/dev/ttyUSB0 BAUD_SCAN=1 npm run probe
 */
import { SerialPort } from 'serialport';
import { defaultSerialPort } from '../src/utils/platform.js';

const PORT = process.env.PORT ?? process.env.SERIAL_PORT ?? defaultSerialPort();
const BAUD = Number(process.env.BAUD ?? process.env.BAUD_RATE ?? 19200);
const SCAN = process.env.BAUD_SCAN === '1';
const OBSERVE_MS = Number(process.env.OBSERVE_MS ?? 2500);

const COMMON_BAUDS = [19200, 9600, 38400, 57600, 115200, 4800, 2400];

function dumpBuf(buf: Buffer): string {
  const hex = [...buf].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const asc = [...buf].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
  return `hex[${buf.length}]: ${hex}\n          ascii: ${asc}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 1つのボーレートで開いて @VR を投げ、受信バイト数を返す。 */
async function probeOnce(baud: number): Promise<number> {
  return new Promise<number>((resolve) => {
    const port = new SerialPort({ path: PORT, baudRate: baud, autoOpen: false });
    let total = 0;

    port.on('data', (buf: Buffer) => {
      total += buf.length;
      console.error(`  RX  ${dumpBuf(buf)}`);
    });
    port.on('error', (e) => console.error('  port error:', e.message));

    port.open(async (err) => {
      if (err) {
        console.error(`  open 失敗 (${baud}): ${err.message}`);
        resolve(0);
        return;
      }
      console.error(`  open OK @ ${baud}bps`);
      // 制御線を明示的に設定(チップによっては必須)。
      port.set({ dtr: true, rts: true }, () => undefined);
      await delay(300);

      console.error('  TX  @VR\\r\\n');
      port.write(Buffer.from('@VR\r\n', 'ascii'));
      port.drain(() => undefined);

      await delay(OBSERVE_MS);
      port.close(() => resolve(total));
    });
  });
}

async function main(): Promise<void> {
  if (SCAN) {
    console.error(`=== ${PORT} ボーレートスキャン ===`);
    for (const baud of COMMON_BAUDS) {
      console.error(`\n--- ${baud}bps を試行 ---`);
      const n = await probeOnce(baud);
      console.error(`  → 受信 ${n} バイト${n > 0 ? '  ★応答あり' : ''}`);
      await delay(200);
    }
  } else {
    console.error(`=== ${PORT} @ ${BAUD}bps 生プローブ (${OBSERVE_MS}ms 観測) ===`);
    const n = await probeOnce(BAUD);
    console.error(`\n受信合計: ${n} バイト${n === 0 ? '  (応答なし)' : ''}`);
  }
}

main();
