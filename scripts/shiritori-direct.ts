/**
 * しりとりオーケストレーター。
 *
 * 役割分担:
 *   - 無線の送受信(LoRa/MLR-429)は、この Node スクリプトが SerialManager を
 *     使って確実に行う。Codex(LLM)の MCP ツール呼び出しは裸のツール名を出して
 *     `unsupported call` になり連続動作が不安定なため、通信はスクリプト側で担当する。
 *   - しりとりの「次の単語を考える」判断は LLM(codex exec)に任せる。
 *     各手番でスクリプトが codex を呼び出し、受信語から次の単語を LLM に生成させ、
 *     その回答を無線で送信する。
 *
 * 使い方:
 *   tsx scripts/shiritori.ts first  --port COM68   先攻(最初に単語を送る)
 *   tsx scripts/shiritori.ts second --port COM30   後攻(最初に受信する)
 *
 * オプション:
 *   --port, -p <port>   シリアルポート(既定: 環境変数 SERIAL_PORT)
 *   --baud, -b <bps>    ボーレート(既定: 環境変数 BAUD_RATE または 19200)
 *   --turns, -n <n>     往復数(既定 5)
 *   --timeout, -t <ms>  1 回の受信待ち(既定 120000)
 *   --model, -m <name>  codex のモデル/プロファイル(既定 fugu)
 */
import { spawn } from 'node:child_process';
import { SerialManager } from '../src/serial/SerialManager.js';
import { QueueTimeoutError } from '../src/utils/MessageQueue.js';
import { defaultSerialPort } from '../src/utils/platform.js';

interface Args {
  role: 'first' | 'second';
  port: string;
  baud: number;
  turns: number;
  timeout: number;
  model: string;
}

function parseArgs(argv: string[]): Args {
  const a = argv.slice(2);
  let role: 'first' | 'second' = 'first';
  let port = process.env.SERIAL_PORT ?? defaultSerialPort();
  let baud = Number(process.env.BAUD_RATE ?? 19200);
  let turns = 5;
  let timeout = 120000;
  let model = 'fugu';
  for (let i = 0; i < a.length; i++) {
    const t = a[i];
    switch (t) {
      case 'first':
      case 'second':
        role = t;
        break;
      case '--port':
      case '-p':
        port = a[++i];
        break;
      case '--baud':
      case '-b':
        baud = Number(a[++i]);
        break;
      case '--turns':
      case '-n':
        turns = Number(a[++i]);
        break;
      case '--timeout':
      case '-t':
        timeout = Number(a[++i]);
        break;
      case '--model':
      case '-m':
        model = a[++i];
        break;
      default:
        break;
    }
  }
  return { role, port, baud, turns, timeout, model };
}

/** ひらがな(＋長音符)だけで構成された語かどうか。 */
function isHiraganaWord(s: string): boolean {
  return /^[ぁ-んー]+$/.test(s);
}

/**
 * codex を呼び出し、LLM にしりとりの単語を1語だけ生成させる。
 * codex exec の標準出力から、ひらがなだけの行を最後の候補として抽出する。
 * LLM が有効な語を返せなかった場合は null を返す(呼び出し側でフォールバック)。
 */
function askLlmForWord(model: string, prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const args = [
      'exec',
      '-p',
      model,
      '--dangerously-bypass-approvals-and-sandbox',
      '-',
    ];
    // shell: true で args を渡すと Node.js が DEP0190 警告を出す。
    // ただし Windows では .cmd を直接 spawn(..., { shell:false }) すると
    // spawn EINVAL になる場合があるため、cmd.exe を明示的に起動する。
    const command = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'codex';
    const commandArgs =
      process.platform === 'win32'
        ? ['/d', '/s', '/c', 'codex.cmd', ...args]
        : args;
    const child = spawn(command, commandArgs, {
      shell: false,
    });

    let stdout = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      // 出力行のうち、ひらがなのみの行を候補にする(最後に現れたものを採用)。
      const candidates = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => isHiraganaWord(line) && !line.endsWith('ん'));
      resolve(candidates.length > 0 ? candidates[candidates.length - 1] : null);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** 先攻の最初の単語を LLM に決めさせる。失敗時は既定語。 */
async function firstWordFromLlm(model: string, used: Set<string>): Promise<string> {
  const prompt =
    'しりとりを始めます。最初の単語を1つだけ考えてください。\n' +
    '出力は「ひらがなだけの単語1語」のみ。説明や記号は一切書かないこと。\n' +
    '語尾が「ん」になる単語は禁止です。';
  const w = await askLlmForWord(model, prompt);
  if (w && !used.has(w)) return w;
  return 'しりとり';
}

/** 受信語に続く単語を LLM に決めさせる。失敗時は null。 */
async function nextWordFromLlm(
  model: string,
  received: string,
  used: Set<string>,
): Promise<string | null> {
  const prompt =
    `しりとりの続きです。相手の単語は「${received}」です。\n` +
    'この単語の最後のかな文字から始まる、別の単語を1つだけ考えてください。\n' +
    '出力は「ひらがなだけの単語1語」のみ。説明や記号は一切書かないこと。\n' +
    '語尾が「ん」になる単語は禁止です。\n' +
    (used.size > 0 ? `すでに使った単語(再使用禁止): ${[...used].join('、')}` : '');
  const w = await askLlmForWord(model, prompt);
  if (w && !used.has(w)) return w;
  return null;
}

async function main(): Promise<void> {
  const { role, port, baud, turns, timeout, model } = parseArgs(process.argv);
  const used = new Set<string>();
  const serial = new SerialManager({ path: port, baudRate: baud });
  await serial.open();
  console.log(
    `しりとり開始: ${role === 'first' ? '先攻' : '後攻'} / ポート ${port} / モデル ${model} / ${turns}往復`,
  );

  try {
    if (role === 'first') {
      let myWord = await firstWordFromLlm(model, used);
      for (let round = 1; round <= turns; round++) {
        used.add(myWord);
        await serial.transmit(myWord);
        process.stdout.write(`${round}往復目: 送信「${myWord}」→ `);
        let recv: string;
        try {
          recv = (await serial.rfReceiveQueue.dequeue(timeout)).trim();
        } catch (err) {
          if (err instanceof QueueTimeoutError) {
            console.log('受信タイムアウト。終了します。');
            break;
          }
          throw err;
        }
        console.log(`受信「${recv}」`);
        used.add(recv);
        if (recv === 'END' || recv.endsWith('ん')) {
          console.log(recv === 'END' ? '相手が END を送信。終了します。' : '相手が「ん」で終わりました。終了します。');
          break;
        }
        if (round === turns) {
          try {
            const tail = (await serial.rfReceiveQueue.dequeue(Math.min(timeout, 30000))).trim();
            console.log(tail === 'END' ? '相手の END を受信。終了します。' : `追加メッセージ「${tail}」を読み捨てます。`);
          } catch (err) {
            if (!(err instanceof QueueTimeoutError)) throw err;
          }
          break;
        }
        const next = await nextWordFromLlm(model, recv, used);
        if (!next) {
          console.log('LLM が次の単語を出せませんでした。END を送信して終了します。');
          await serial.transmit('END');
          break;
        }
        myWord = next;
      }
    } else {
      for (let round = 1; round <= turns; round++) {
        let recv: string;
        try {
          recv = (await serial.rfReceiveQueue.dequeue(timeout)).trim();
        } catch (err) {
          if (err instanceof QueueTimeoutError) {
            console.log(`${round}往復目: 受信タイムアウト。終了します。`);
            break;
          }
          throw err;
        }
        used.add(recv);
        if (recv === 'END' || recv.endsWith('ん')) {
          console.log(`${round}往復目: 受信「${recv}」。終了します。`);
          break;
        }
        process.stdout.write(`${round}往復目: 受信「${recv}」→ `);
        const next = await nextWordFromLlm(model, recv, used);
        if (!next) {
          console.log('LLM が次の単語を出せませんでした。END を送信して終了します。');
          await serial.transmit('END');
          break;
        }
        used.add(next);
        await serial.transmit(next);
        console.log(`送信「${next}」`);
        if (round === turns) {
          await serial.transmit('END');
          console.log('規定往復数に到達。END を送信して終了します。');
          break;
        }
      }
    }
  } finally {
    await serial.close();
  }
  console.log('しりとり終了。');
}

main().catch((err) => {
  console.error('エラー:', (err as Error).message);
  process.exit(1);
});