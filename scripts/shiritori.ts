/// <reference types="node" />

/**
 * Codex(MCP) しりとりランナー（1アクション=1 Codex実行方式）。
 *
 * このスクリプト自体は無線送受信を行わない。無線通信は必ず AI(Codex) の
 * MCP tool call:
 *
 *   - radiogram/send_message
 *   - radiogram/receive_message
 *
 * によって行われる。従来は 1 回の Codex セッションで何往復もさせていたため、
 * 2 個目以降の tool call で AI が裸のツール名(send_message)を出して
 * 「unsupported call: send_message」になり停止していた。
 *
 * 本実装では「送信」「受信」を毎回それぞれ独立した codex exec として起動し、
 * 各実行で AI に MCP ツールを 1 回だけ呼ばせる。これにより
 * 「AI 自身が MCP を使って無線通信する」構成を保ったまま、往復途中での
 * ツール名ゆらぎ問題を回避する。ゲームの進行（使用済み単語・往復数）は
 * Node 側が管理し、AI 出力からマーカー行を抽出して結果を取得する。
 * unsupported call やマーカー欠落時はアクション単位で再試行する。
 *
 * 使い方:
 *   tsx scripts/shiritori.ts first  --port COM68   先攻
 *   tsx scripts/shiritori.ts second --port COM30   後攻
 *
 * 既定では実行前に `npm run build` を実行し、Codex に
 * `node dist/cli.js serve` を radiogram MCP サーバーとして渡す。
 *
 * オプション:
 *   --port, -p <port>       シリアルポート(既定: 環境変数 SERIAL_PORT)
 *   --baud, -b <bps>        ボーレート(既定: 環境変数 BAUD_RATE または 19200)
 *   --turns, -n <n>         往復数(既定 5)
 *   --timeout, -t <ms>      1 回の受信待ち(既定 120000)
 *   --profile <name>        codex のプロファイル(既定 fugu)
 *   --model, -m <name>      codex のモデル(既定 fugu)
 *   --codex <command>       Codex CLI コマンド(既定: codex.cmd / codex)
 *   --server <path>         radiogram MCP サーバー JS(既定: dist/cli.js)
 *   --registered            Codex に登録済みの radiogram 設定を使う(command/argsを上書きしない)
 *   --no-build              起動前の npm run build を省略
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Role = 'first' | 'second';

interface Args {
  role: Role;
  port: string;
  baud: number;
  turns: number;
  timeout: number;
  model: string;
  profile: string;
  codex: string;
  serverPath: string;
  useRegisteredServer: boolean;
  build: boolean;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');

/** 1 アクションの Codex 実行あたりの最大再試行回数。 */
const MAX_ACTION_RETRY = 3;
/** 受信タイムアウト時に受信アクションを繰り返す最大回数。 */
const MAX_RECEIVE_RETRY = 3;
/**
 * シリアルポートは 1 プロセスしか開けない。前の codex(子 MCP サーバー)が
 * ポートを解放するのを待つため、アクション間に少し間を置く。
 */
const SETTLE_MS = 1500;

function defaultSerialPort(): string {
  return process.platform === 'win32' ? 'COM1' : '/dev/ttyUSB0';
}

function defaultCodexCommand(): string {
  return process.platform === 'win32' ? 'codex.cmd' : 'codex';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv: string[]): Args {
  const a = argv.slice(2);
  let role: Role = 'first';
  let port = process.env.SERIAL_PORT ?? defaultSerialPort();
  let baud = Number(process.env.BAUD_RATE ?? 19200);
  let turns = 5;
  let timeout = 120000;
  let model = 'fugu';
  let profile = process.env.CODEX_PROFILE ?? 'fugu';
  let codex = process.env.CODEX_BIN ?? defaultCodexCommand();
  let serverPath = path.join(projectRoot, 'dist', 'cli.js');
  let useRegisteredServer = false;
  let build = true;

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
      case '--profile':
        profile = a[++i];
        break;
      case '--codex':
        codex = a[++i];
        break;
      case '--server':
        serverPath = path.resolve(a[++i]);
        break;
      case '--registered':
        useRegisteredServer = true;
        break;
      case '--no-build':
        build = false;
        break;
      default:
        throw new Error(`不明な引数です: ${t}`);
    }
  }

  if (!Number.isFinite(baud) || baud <= 0) throw new Error(`baud が不正です: ${baud}`);
  if (!Number.isInteger(turns) || turns <= 0) throw new Error(`turns が不正です: ${turns}`);
  if (!Number.isInteger(timeout) || timeout < 0) throw new Error(`timeout が不正です: ${timeout}`);

  return {
    role,
    port,
    baud,
    turns,
    timeout,
    model,
    profile,
    codex,
    serverPath,
    useRegisteredServer,
    build,
  };
}

function tomlString(value: string): string {
  // Codex の `-c key=value` は TOML 値として解釈されるため、JSON 文字列形式で安全に渡す。
  return JSON.stringify(value);
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

/**
 * Windows で `.cmd`(npm.cmd / codex.cmd)を spawn(..., { shell:false }) すると
 * Node.js の新しめのバージョンで spawn EINVAL になる。これを避けるため、
 * Windows では cmd.exe を明示的に起動して .cmd を実行する。
 */
function resolveSpawn(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command, args };
  if (/\.cmd$/i.test(command) || command === 'npm' || command === 'codex') {
    const cmdName = /\.cmd$/i.test(command) ? command : `${command}.cmd`;
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', cmdName, ...args],
    };
  }
  return { command, args };
}

function runProcess(command: string, args: string[], options: { cwd: string; stdio: 'inherit' | 'pipe' }): Promise<number> {
  return new Promise((resolve, reject) => {
    const resolved = resolveSpawn(command, args);
    const child = spawn(resolved.command, resolved.args, {
      cwd: options.cwd,
      stdio: options.stdio,
      shell: false,
      env: process.env,
    });

    child.on('error', reject);
    child.on('close', (code: number | null) => resolve(code ?? 1));
  });
}

async function buildServerIfNeeded(args: Args): Promise<void> {
  if (!args.build || args.useRegisteredServer) return;

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log('[shiritori-mcp] radiogram MCP サーバーをビルドします: npm run build');
  const code = await runProcess(npm, ['run', 'build'], { cwd: projectRoot, stdio: 'inherit' });
  if (code !== 0) {
    throw new Error(`npm run build が失敗しました(exit=${code})`);
  }

  if (!existsSync(args.serverPath)) {
    throw new Error(`MCP サーバーファイルが見つかりません: ${args.serverPath}`);
  }
}

function makeCodexArgs(args: Args): string[] {
  const toolTimeoutSec = Math.max(120, Math.ceil(args.timeout / 1000) + 30);
  const codexArgs = [
    '-p',
    args.profile,
    'exec',
    '-m',
    args.model,
    '--dangerously-bypass-approvals-and-sandbox',
    '-c',
    `mcp_servers.radiogram.env.SERIAL_PORT=${tomlString(args.port)}`,
    '-c',
    `mcp_servers.radiogram.env.BAUD_RATE=${tomlString(String(args.baud))}`,
    '-c',
    'mcp_servers.radiogram.startup_timeout_sec=30',
    '-c',
    `mcp_servers.radiogram.tool_timeout_sec=${toolTimeoutSec}`,
  ];

  if (!args.useRegisteredServer) {
    const serverPath = toPosixPath(path.resolve(args.serverPath));
    codexArgs.push(
      '-c',
      'mcp_servers.radiogram.command="node"',
      '-c',
      `mcp_servers.radiogram.args=[${tomlString(serverPath)},"serve"]`,
    );
  }

  codexArgs.push('-');
  return codexArgs;
}

/** 1 回の codex exec を起動し、stdout/stderr を捕捉しつつ画面にも流す。 */
function runCodexAction(
  args: Args,
  prompt: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const codexArgs = makeCodexArgs(args);
    const resolved = resolveSpawn(args.codex, codexArgs);
    const child = spawn(resolved.command, resolved.args, {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      process.stdout.write(s);
    });
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      process.stderr.write(s);
    });

    child.on('error', reject);
    child.on('close', (code: number | null) => resolve({ code: code ?? 1, stdout, stderr }));

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** 出力から「MARKER: 値」形式の最後の行を抽出する。 */
function extractMarker(output: string, marker: string): string | null {
  const found = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(marker));
  if (found.length === 0) return null;
  return found[found.length - 1].slice(marker.length).trim();
}

/**
 * Codex router が実際に「未対応のツール呼び出し」を報告したか。
 *
 * Codex のログには入力プロンプトも含まれるため、単にエラー名を検索すると
 * プロンプト中の説明文を誤検出する。router の ERROR 行にだけ一致させる。
 */
function hasUnsupportedCall(output: string): boolean {
  return output
    .split(/\r?\n/)
    .some((line) =>
      /\bERROR\b.*\bcodex_core::tools::router\b.*\berror=unsupported call:/i.test(line),
    );
}

const COMMON_RULES = `
【厳守: MCPツール名】
- 使ってよいのは server 名付きの完全名だけです。
- 送信は radiogram/send_message、受信は radiogram/receive_message。
- server名を省略したツール名は使用禁止です。必ず上記の完全名を使ってください。
- シェル、Node.js、Python、直接シリアル通信、ファイル経由通信は使わないでください。
`.trim();

const SHIRITORI_RULES = `
【しりとりルール】
- 日本語のひらがな単語だけを使ってください。
- 語尾が「ん」になる単語は禁止です。
- 同じ単語の再使用は禁止です。
- 受け取った単語の最後のかな文字から始まる単語を返してください。
- 小さい文字「ゃゅょっぁぃぅぇぉ」で終わる場合は、対応する大きい音として扱ってください。
- 長音「ー」で終わる場合は、その直前のかなを最後のかなとして扱ってください。
`.trim();

function makeReceivePrompt(args: Args): string {
  return `
あなたはLoRa無線でしりとりを行うプレイヤーの通信担当です。
今回のあなたの仕事は「相手の単語を1回だけ受信する」ことだけです。

${COMMON_RULES}

手順:
1. radiogram/receive_message を1回だけ呼び出してください。引数は {"timeoutMs": ${args.timeout}} です。
2. 送信(radiogram/send_message)は絶対に行わないでください。
3. 受信が完了したら、受信できた文字列だけを次の1行の形式で出力してください:
   RECEIVED: 受信した文字列
4. 受信結果が「(受信メッセージなし: タイムアウト)」だった場合は、次を出力してください:
   RECEIVED: (timeout)
5. RECEIVED 行以外の余計な説明は出力しないでください。

今すぐ radiogram/receive_message を1回だけ実行してください。
`.trim();
}

function makeFirstSendPrompt(args: Args): string {
  return `
あなたはLoRa無線でしりとりを行う先攻プレイヤーの通信担当です。
今回のあなたの仕事は「しりとりの最初の単語を1つ考えて1回だけ送信する」ことだけです。

${COMMON_RULES}

${SHIRITORI_RULES}

手順:
1. しりとりの最初の単語(ひらがな、語尾が「ん」でない)を1つ考えてください。
2. radiogram/send_message を1回だけ呼び出してください。引数は {"text": "考えた単語"} です。
3. 受信(radiogram/receive_message)は行わないでください。
4. 送信が完了したら、送った単語だけを次の1行の形式で出力してください:
   SENT: 送った単語
5. SENT 行以外の余計な説明は出力しないでください。

今すぐ最初の単語を送信してください。
`.trim();
}

function makeSendPrompt(args: Args, received: string, used: string[]): string {
  const usedLine = used.length > 0 ? used.join('、') : '(なし)';
  return `
あなたはLoRa無線でしりとりを行うプレイヤーの通信担当です。
今回のあなたの仕事は「次の単語を1つ考えて1回だけ送信する」ことだけです。

${COMMON_RULES}

${SHIRITORI_RULES}

相手から受信した直前の単語: 「${received}」
これまでに使用済みの単語(再使用禁止): ${usedLine}

手順:
1. 受信語「${received}」の最後のかな文字から始まる、未使用のひらがな単語を1つ考えてください。
2. radiogram/send_message を1回だけ呼び出してください。引数は {"text": "考えた単語"} です。
3. 受信(radiogram/receive_message)は行わないでください。
4. 送信が完了したら、送った単語だけを次の1行の形式で出力してください:
   SENT: 送った単語
5. SENT 行以外の余計な説明は出力しないでください。

今すぐ次の単語を送信してください。
`.trim();
}

function makeEndPrompt(_args: Args): string {
  return `
あなたはLoRa無線でしりとりを行うプレイヤーの通信担当です。
今回のあなたの仕事は「終了合図 END を1回だけ送信する」ことだけです。

${COMMON_RULES}

手順:
1. radiogram/send_message を1回だけ呼び出してください。引数は {"text": "END"} です。文字は必ず半角大文字の END にしてください。
2. 受信(radiogram/receive_message)は行わないでください。
3. 送信が完了したら、次の1行だけを出力してください:
   SENT: END
4. SENT 行以外の余計な説明は出力しないでください。

今すぐ END を送信してください。
`.trim();
}

type ReceiveResult =
  | { status: 'ok'; text: string }
  | { status: 'timeout' }
  | { status: 'failed' };

/** AI に受信を 1 回実行させ、RECEIVED マーカーを解釈する(再試行あり)。 */
async function receiveViaCodex(args: Args): Promise<ReceiveResult> {
  for (let attempt = 1; attempt <= MAX_ACTION_RETRY; attempt++) {
    const { code, stdout, stderr } = await runCodexAction(args, makeReceivePrompt(args));
    const combined = `${stdout}\n${stderr}`;
    const value = extractMarker(stdout, 'RECEIVED:');

    if (hasUnsupportedCall(combined)) {
      console.warn(`[shiritori-mcp] 受信で unsupported call を検出。再試行 ${attempt}/${MAX_ACTION_RETRY}`);
    } else if (code !== 0) {
      console.warn(`[shiritori-mcp] 受信 Codex が異常終了(exit=${code})。再試行 ${attempt}/${MAX_ACTION_RETRY}`);
    } else if (value && value !== '(timeout)') {
      return { status: 'ok', text: value };
    } else if (value === '(timeout)') {
      return { status: 'timeout' };
    } else {
      console.warn(`[shiritori-mcp] 受信結果を解釈できませんでした。再試行 ${attempt}/${MAX_ACTION_RETRY}`);
    }
    await sleep(SETTLE_MS);
  }
  return { status: 'failed' };
}

/** AI に送信を 1 回実行させ、SENT マーカーを解釈する(再試行あり)。 */
async function sendViaCodex(args: Args, prompt: string): Promise<string | null> {
  for (let attempt = 1; attempt <= MAX_ACTION_RETRY; attempt++) {
    const { code, stdout, stderr } = await runCodexAction(args, prompt);
    const combined = `${stdout}\n${stderr}`;
    const value = extractMarker(stdout, 'SENT:');

    if (hasUnsupportedCall(combined)) {
      console.warn(`[shiritori-mcp] 送信で unsupported call を検出。再試行 ${attempt}/${MAX_ACTION_RETRY}`);
    } else if (code !== 0) {
      console.warn(`[shiritori-mcp] 送信 Codex が異常終了(exit=${code})。再試行 ${attempt}/${MAX_ACTION_RETRY}`);
    } else if (value) {
      return value;
    } else {
      console.warn(`[shiritori-mcp] 送信結果を解釈できませんでした。再試行 ${attempt}/${MAX_ACTION_RETRY}`);
    }
    await sleep(SETTLE_MS);
  }
  return null;
}

/** タイムアウト時は受信アクション自体を繰り返す。 */
async function receiveWithRetry(args: Args): Promise<ReceiveResult> {
  for (let attempt = 1; attempt <= MAX_RECEIVE_RETRY; attempt++) {
    const result = await receiveViaCodex(args);
    if (result.status === 'ok' || result.status === 'failed') {
      return result;
    }
    // timeout
    console.warn(`[shiritori-mcp] 受信タイムアウト。受信を再試行 ${attempt}/${MAX_RECEIVE_RETRY}`);
    await sleep(SETTLE_MS);
  }
  return { status: 'timeout' };
}

function isEnd(word: string): boolean {
  return word.trim().toUpperCase() === 'END';
}

function endsWithN(word: string): boolean {
  return word.trim().endsWith('ん');
}

async function playFirst(args: Args): Promise<void> {
  const used: string[] = [];
  let received = '';

  for (let round = 1; round <= args.turns; round++) {
    // --- 送信 ---
    const prompt = round === 1 ? makeFirstSendPrompt(args) : makeSendPrompt(args, received, used);
    console.log(`\n=== ${round}往復目: 送信フェーズ ===`);
    const sent = await sendViaCodex(args, prompt);
    if (!sent) {
      console.log('[shiritori-mcp] 送信に失敗しました。終了します。');
      return;
    }
    used.push(sent);
    console.log(`[shiritori-mcp] ${round}往復目: 送信「${sent}」`);
    await sleep(SETTLE_MS);

    // --- 受信 ---
    console.log(`\n=== ${round}往復目: 受信フェーズ ===`);
    const result = await receiveWithRetry(args);
    if (result.status !== 'ok') {
      console.log('[shiritori-mcp] 受信できませんでした。終了します。');
      return;
    }
    received = result.text;
    used.push(received);
    console.log(`[shiritori-mcp] ${round}往復目: 受信「${received}」`);

    if (isEnd(received)) {
      console.log('[shiritori-mcp] 相手が END を送信。終了します。');
      return;
    }
    if (endsWithN(received)) {
      console.log('[shiritori-mcp] 相手が「ん」で終わりました。終了します。');
      return;
    }
    await sleep(SETTLE_MS);
  }

  console.log('[shiritori-mcp] 規定往復数に到達。相手の END を待ちます。');
  const endWaitArgs = { ...args, timeout: Math.min(args.timeout, 30000) };
  const endResult = await receiveViaCodex(endWaitArgs);
  if (endResult.status === 'ok' && isEnd(endResult.text)) {
    console.log('[shiritori-mcp] 相手の END を受信。終了します。');
  } else {
    console.log('[shiritori-mcp] END は受信できませんでしたが、規定往復数のため終了します。');
  }
}

async function playSecond(args: Args): Promise<void> {
  const used: string[] = [];

  for (let round = 1; round <= args.turns; round++) {
    // --- 受信 ---
    console.log(`\n=== ${round}往復目: 受信フェーズ ===`);
    const result = await receiveWithRetry(args);
    if (result.status !== 'ok') {
      console.log('[shiritori-mcp] 受信できませんでした。終了します。');
      return;
    }
    const received = result.text;
    used.push(received);
    console.log(`[shiritori-mcp] ${round}往復目: 受信「${received}」`);

    if (isEnd(received)) {
      console.log('[shiritori-mcp] 相手が END を送信。終了します。');
      return;
    }
    if (endsWithN(received)) {
      console.log('[shiritori-mcp] 相手が「ん」で終わりました。終了します。');
      return;
    }
    await sleep(SETTLE_MS);

    // --- 送信 ---
    console.log(`\n=== ${round}往復目: 送信フェーズ ===`);
    const sent = await sendViaCodex(args, makeSendPrompt(args, received, used));
    if (!sent) {
      console.log('[shiritori-mcp] 送信に失敗しました。END を送信して終了します。');
      await sendViaCodex(args, makeEndPrompt(args));
      return;
    }
    used.push(sent);
    console.log(`[shiritori-mcp] ${round}往復目: 送信「${sent}」`);
    await sleep(SETTLE_MS);

    if (round === args.turns) {
      // 最終往復の応答語を送った後、別アクションで END を送る。
      const ended = await sendViaCodex(args, makeEndPrompt(args));
      if (ended && isEnd(ended)) {
        console.log('[shiritori-mcp] 規定往復数に到達。END を送信して終了します。');
      } else {
        console.log('[shiritori-mcp] END の送信に失敗しました。終了します。');
      }
      return;
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  await buildServerIfNeeded(args);

  console.log(
    [
      '[shiritori-mcp] Codex MCP しりとりを開始します(1アクション=1 Codex実行方式)',
      `  role: ${args.role === 'first' ? '先攻' : '後攻'}`,
      `  port: ${args.port}`,
      `  baud: ${args.baud}`,
      `  turns: ${args.turns}`,
      `  timeoutMs: ${args.timeout}`,
      `  model: ${args.model}`,
      `  profile: ${args.profile}`,
      `  MCP server: ${args.useRegisteredServer ? 'registered radiogram' : args.serverPath}`,
    ].join('\n'),
  );

  if (args.role === 'first') {
    await playFirst(args);
  } else {
    await playSecond(args);
  }

  console.log('[shiritori-mcp] しりとり終了。');
}

main().catch((err) => {
  console.error('[shiritori-mcp] エラー:', (err as Error).message);
  process.exit(1);
});