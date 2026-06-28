/**
 * 2ポート(送信機/受信機)折り返し送受信テスト。
 *
 * 同一PCに接続した2台の MLR-429 を両方開き、
 * 双方向にテキストを送受信して交信を確認する。
 *
 * 無線の実効速度が遅い(≈240bps)ため、受信待ちのタイムアウトは長めに取る。
 *
 * 使い方 (ポートは OS に合わせて: Win COMx / Linux /dev/ttyUSBx / macOS /dev/tty.usbserial-*):
 *   PORT_A=/dev/ttyUSB0 PORT_B=/dev/ttyUSB1 npm run test:twoport
 *   PORT_A=COM18 PORT_B=COM44 RX_TIMEOUT=60000 npm run test:twoport   (Windows)
 */
import { SerialManager } from '../src/serial/SerialManager.js';
import { defaultSerialPort } from '../src/utils/platform.js';

const PORT_A = process.env.PORT_A ?? defaultSerialPort();
// 2台目の既定。Linux は /dev/ttyUSB1、それ以外は PORT_B を明示指定する想定。
const PORT_B = process.env.PORT_B ?? (process.platform === 'linux' ? '/dev/ttyUSB1' : defaultSerialPort());
const BAUD = Number(process.env.BAUD_RATE ?? 19200);
// 無線が遅い(≈240bps)ので受信待ちは長めに。
const RX_TIMEOUT = Number(process.env.RX_TIMEOUT ?? 60000);

/** 1方向の送受信を検証する。 */
async function oneWay(
  txName: string,
  tx: SerialManager,
  rxName: string,
  rx: SerialManager,
  text: string,
): Promise<boolean> {
  console.error(`\n[${txName} → ${rxName}] 送信: "${text}"`);
  // 取りこぼし防止に受信待ちを先に仕掛ける(キューはバッファされるが念のため)。
  const recvP = rx.rfReceiveQueue.dequeue(RX_TIMEOUT);
  const started = Date.now();
  await tx.transmit(text);
  console.error(`  送信完了 (*IR=03) — ${Date.now() - started}ms`);
  console.error(`  ${rxName} で受信待機中 (最大 ${RX_TIMEOUT}ms)...`);
  try {
    const got = await recvP;
    const ok = got === text;
    console.error(
      `  受信: "${got}" — ${ok ? 'OK ✓ 一致' : 'NG ✗ 不一致'} (${Date.now() - started}ms)`,
    );
    return ok;
  } catch (err) {
    console.error(`  受信失敗: ${(err as Error).message}`);
    return false;
  }
}

async function main(): Promise<void> {
  const a = new SerialManager({ path: PORT_A, baudRate: BAUD });
  const b = new SerialManager({ path: PORT_B, baudRate: BAUD });

  await a.open();
  await b.open();
  console.error(`--- A=${PORT_A} / B=${PORT_B} @ ${BAUD}bps (RX_TIMEOUT=${RX_TIMEOUT}ms) ---`);

  let allOk = true;
  try {
    // 両機の状態を確認(チャンネル/モードが一致していないと交信できない)。
    const [sa, sb] = await Promise.all([a.getStatus(), b.getStatus()]);
    console.error(
      `\n[状態] ${PORT_A}: ver=${sa.version} ch=${sa.channel} mode=${sa.modeName}`,
    );
    console.error(
      `[状態] ${PORT_B}: ver=${sb.version} ch=${sb.channel} mode=${sb.modeName}`,
    );
    if (sa.channel !== sb.channel || sa.mode !== sb.mode) {
      console.error(
        '  ⚠ チャンネルまたはモードが一致していません。交信できない可能性があります。',
      );
    }

    // A → B
    allOk = (await oneWay(PORT_A, a, PORT_B, b, `hello from ${PORT_A}`)) && allOk;
    // B → A
    allOk = (await oneWay(PORT_B, b, PORT_A, a, `hello from ${PORT_B}`)) && allOk;

    console.error(`\n=== 結果: ${allOk ? '全て成功 ✓' : '失敗あり ✗'} ===`);
  } catch (err) {
    console.error('エラー:', (err as Error).message);
    allOk = false;
  } finally {
    await a.close();
    await b.close();
  }
  process.exitCode = allOk ? 0 : 1;
}

main();
