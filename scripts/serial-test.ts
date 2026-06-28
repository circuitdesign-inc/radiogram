/**
 * 実機疎通テスト(MCP を介さず SerialManager を直接叩く)。
 *
 * 使い方 (ポートは OS に合わせて指定: Win COMx / Linux /dev/ttyUSBx / macOS /dev/tty.usbserial-*):
 *   SERIAL_PORT=/dev/ttyUSB0 npm run test:serial
 *   SERIAL_PORT=/dev/ttyUSB0 npm run test:serial -- send "hello"
 *   SERIAL_PORT=/dev/ttyUSB0 npm run test:serial -- recv 60000
 *
 * 引数なしの場合は get_radio_status 相当(version/channel/mode)を表示する。
 */
import { SerialManager } from '../src/serial/SerialManager.js';
import { defaultSerialPort } from '../src/utils/platform.js';

const PORT = process.env.SERIAL_PORT ?? defaultSerialPort();
const BAUD = Number(process.env.BAUD_RATE ?? 19200);

async function main(): Promise<void> {
  const [, , action, arg] = process.argv;
  const serial = new SerialManager({ path: PORT, baudRate: BAUD });

  await serial.open();
  console.error(`--- ${PORT} @ ${BAUD}bps ---`);

  try {
    if (action === 'send') {
      const text = arg ?? 'test';
      console.error(`送信中: "${text}"`);
      await serial.transmit(text);
      console.error('送信完了');
    } else if (action === 'recv') {
      const timeout = arg ? Number(arg) : 60000;
      console.error(`受信待機中 (${timeout}ms)...`);
      const msg = await serial.rfReceiveQueue.dequeue(timeout);
      console.error('受信:', JSON.stringify(msg));
    } else {
      // 既定: 状態取得
      const status = await serial.getStatus();
      console.error('バージョン:', status.version);
      console.error('チャンネル:', status.channel);
      console.error('モード:', status.modeName, `(0x${status.mode.toString(16)})`);
    }
  } catch (err) {
    console.error('エラー:', (err as Error).message);
    process.exitCode = 1;
  } finally {
    await serial.close();
  }
}

main();
