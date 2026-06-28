/**
 * MLR-429 シリアルプロトコル（純粋関数のみ。I/O は持たない）
 *
 * 実機ファーム(MLR429 trunk/SRC)で確認したフレーム仕様:
 *
 *  送信(TX):   @DT<LL><data>\r\n     LL = data の UTF-8 バイト数(16進2桁)
 *    ack:      *DT=<LL>\r\n          コマンド受理
 *    完了:     *IR=03\r\n            送信完了
 *    失敗:     *IR=01 (キャリアセンス) / *IR=02 (相関センス)
 *
 *  受信(RX):   *DR=<LL><data>\r\n    外部から届いた RF データ(LL 長プレフィックス付き)
 *
 *  チャンネル: @CH<XX>[/W]\r\n  → *CH=<XX>\r\n     (照会は @CH\r\n)
 *  モード:     @MO<XX>[/W]\r\n  → *MO=<XX>\r\n     (照会は @MO\r\n)
 *  バージョン: @VR\r\n          → *VR=<string>\r\n
 *
 *  共通エラー: *ER=01(ロック) / 02(データ) / 03(フォーマット) / 04(パスワード) / 05(受信状態)
 *  書込成功:   *WR=PS\r\n   (/W サフィックス付きコマンド時)
 *
 * 注: CH / MO / VR は LL 長フィールドを使わず @ + コマンド + 引数 で直接続く。
 *     DT のみ LL フィールドを持つ。
 */

export const CR_LF = '\r\n';

/** 通信モード(E_MODEM_MODE の値)。FSK_B(0)/LoRa_B(2) は設定不可。 */
export const MODE = {
  FSK: 0x01,
  LORA: 0x03,
  AIR_MONITOR: 0x04,
} as const;

export type ModeName = 'FSK' | 'LoRa';

/** モード別の最大ペイロード(バイト)。 */
export const MAX_PAYLOAD: Record<ModeName, number> = {
  FSK: 60,
  LoRa: 250,
};

/** 数値を16進2桁(大文字)に整形する。 */
export function toHex2(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, '0');
}

/**
 * データ送信コマンド @DT<LL><data>\r\n を組み立てる。
 * data は UTF-8 で符号化し、LL はそのバイト数。
 * 戻り値は Buffer（マルチバイト文字をそのまま送るため）。
 */
export function buildDataCommand(text: string): Buffer {
  const data = Buffer.from(text, 'utf8');
  const header = Buffer.from(`@DT${toHex2(data.length)}`, 'ascii');
  const tail = Buffer.from(CR_LF, 'ascii');
  return Buffer.concat([header, data, tail]);
}

/**
 * LL フィールドを持たない単純コマンド @<code><args>\r\n を組み立てる。
 * 照会(args 省略)・設定の両方で使用。CH / MO / VR 等。
 */
export function buildSimpleCommand(code: string, args = ''): Buffer {
  return Buffer.from(`@${code}${args}${CR_LF}`, 'ascii');
}

/** よく使うコマンドの組み立てヘルパ。 */
export const cmd = {
  transmit: (text: string): Buffer => buildDataCommand(text),
  getVersion: (): Buffer => buildSimpleCommand('VR'),
  getChannel: (): Buffer => buildSimpleCommand('CH'),
  setChannel: (channel: number, save = false): Buffer =>
    buildSimpleCommand('CH', toHex2(channel) + (save ? '/W' : '')),
  getMode: (): Buffer => buildSimpleCommand('MO'),
  setMode: (mode: number, save = false): Buffer =>
    buildSimpleCommand('MO', toHex2(mode) + (save ? '/W' : '')),
};

/** デバイスから受信した1行を解析した結果(判別共用体)。 */
export type DeviceResponse =
  | { type: 'data'; raw: string; payload: string; length: number } // *DR= 外部受信
  | { type: 'txAck'; raw: string; length: number }                 // *DT= 送信受理
  | { type: 'txDone'; raw: string }                                // *IR=03 送信完了
  | { type: 'txError'; raw: string; code: string }                 // *IR=01/02 送信失敗
  | { type: 'error'; raw: string; code: string }                   // *ER=XX
  | { type: 'write'; raw: string }                                 // *WR=PS
  | { type: 'channel'; raw: string; channel: number }              // *CH=XX
  | { type: 'mode'; raw: string; mode: number }                    // *MO=XX
  | { type: 'version'; raw: string; version: string }              // *VR=...
  | { type: 'rssi'; raw: string; text: string }                    // RSSI=.. / *RA= / *RS=
  | { type: 'unknown'; raw: string };

/** 行末の CR/LF を除去する。 */
function stripEol(line: string): string {
  return line.replace(/[\r\n]+$/, '');
}

/**
 * デバイス出力1行を DeviceResponse に解析する。
 * 入力は改行で分割済みの1行(末尾 CR/LF は許容)。
 */
export function parseLine(rawLine: string): DeviceResponse {
  const raw = stripEol(rawLine);

  if (raw.startsWith('*DR=')) {
    const body = raw.slice(4);
    const length = parseInt(body.slice(0, 2), 16);
    const payload = body.slice(2);
    return { type: 'data', raw, payload, length: Number.isNaN(length) ? payload.length : length };
  }
  if (raw.startsWith('*DT=')) {
    const length = parseInt(raw.slice(4, 6), 16);
    return { type: 'txAck', raw, length: Number.isNaN(length) ? 0 : length };
  }
  if (raw === '*IR=03') {
    return { type: 'txDone', raw };
  }
  if (raw === '*IR=01' || raw === '*IR=02') {
    return { type: 'txError', raw, code: raw.slice(4) };
  }
  if (raw.startsWith('*ER=')) {
    return { type: 'error', raw, code: raw.slice(4) };
  }
  if (raw === '*WR=PS') {
    return { type: 'write', raw };
  }
  if (raw.startsWith('*CH=')) {
    return { type: 'channel', raw, channel: parseInt(raw.slice(4), 16) };
  }
  if (raw.startsWith('*MO=')) {
    return { type: 'mode', raw, mode: parseInt(raw.slice(4), 16) };
  }
  if (raw.startsWith('*VR=')) {
    return { type: 'version', raw, version: raw.slice(4) };
  }
  if (raw.startsWith('RSSI=') || raw.startsWith('*RA=') || raw.startsWith('*RS=')) {
    return { type: 'rssi', raw, text: raw };
  }
  return { type: 'unknown', raw };
}

/** *ER= コードの人間可読な説明。 */
export function describeError(code: string): string {
  switch (code) {
    case '01': return 'コマンドロック中(他コマンド処理中)';
    case '02': return 'データ値エラー';
    case '03': return 'コマンドフォーマットエラー';
    case '04': return 'パスワードエラー';
    case '05': return '受信状態エラー';
    default: return `不明なエラー(${code})`;
  }
}
