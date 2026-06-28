/**
 * MLR-429 とのシリアル通信を管理する。
 *
 * 設計の要点:
 *  - 半二重直列化: cmdLock(Promise チェーン)で同時に 1 コマンドのみ in-flight。
 *  - 受信ルーティング: 解析結果が *DR=(外部受信データ)なら rfReceiveQueue へ。
 *    それ以外(ack/完了/エラー/照会応答)は実行中コマンドのハンドラへ渡す。
 *    送信受理は *DT=、送信完了は *IR=03 で、*DR= が送信エコーになることは無い。
 */
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import {
  cmd,
  parseLine,
  describeError,
  MODE,
  MAX_PAYLOAD,
  type DeviceResponse,
  type ModeName,
} from './protocol.js';
import { MessageQueue } from '../utils/MessageQueue.js';
import { logger } from '../utils/logger.js';

export interface SerialManagerOptions {
  path: string;
  baudRate?: number;
}

export interface RadioStatus {
  version: string;
  channel: number;
  mode: number;
  modeName: string;
}

interface PendingCommand {
  description: string;
  /** 応答を処理し、コマンドが完了(解決/拒否)したら true を返す。 */
  handle: (resp: DeviceResponse) => boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_BAUD = 19200;
const DEFAULT_TIMEOUT = 5000;
const TX_TIMEOUT = 10000;

/** モード番号 → 表示名。 */
function modeName(mode: number): string {
  switch (mode) {
    case MODE.FSK: return 'FSK';
    case MODE.LORA: return 'LoRa';
    case MODE.AIR_MONITOR: return 'AIR_MONITOR';
    default: return `0x${mode.toString(16)}`;
  }
}

export class SerialManager {
  private readonly port: SerialPort;
  private readonly parser: ReadlineParser;
  private pending: PendingCommand | null = null;
  /** 直前コマンド完了を待つための Promise チェーン(mutex)。 */
  private cmdLock: Promise<unknown> = Promise.resolve();

  /** 外部から届いた RF 受信データのキュー。 */
  readonly rfReceiveQueue = new MessageQueue<string>();

  constructor(opts: SerialManagerOptions) {
    this.port = new SerialPort({
      path: opts.path,
      baudRate: opts.baudRate ?? DEFAULT_BAUD,
      autoOpen: false,
    });
    this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
    this.parser.on('data', (line: string) => this.onLine(line));
    this.port.on('error', (err) => logger.error('シリアルポートエラー:', err.message));
  }

  /** ポートを開く。 */
  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port.open((err) => {
        if (err) {
          reject(new Error(`ポート ${this.port.path} を開けません: ${err.message}`));
        } else {
          logger.info(`シリアルポート ${this.port.path} を開きました (${this.port.baudRate}bps)`);
          resolve();
        }
      });
    });
  }

  /** ポートを閉じる。 */
  close(): Promise<void> {
    return new Promise((resolve) => {
      this.rfReceiveQueue.clear('ポートを閉じました');
      if (!this.port.isOpen) {
        resolve();
        return;
      }
      this.port.close(() => resolve());
    });
  }

  /** 受信1行のルーティング。 */
  private onLine(rawLine: string): void {
    const resp = parseLine(rawLine);
    logger.debug('RX:', resp.type, resp.raw);

    // 外部からの受信データは常に受信キューへ(送信エコーではない)。
    if (resp.type === 'data') {
      this.rfReceiveQueue.enqueue(resp.payload);
      return;
    }

    // それ以外は実行中コマンドへ。
    if (this.pending) {
      const settled = this.pending.handle(resp);
      if (settled) this.finishPending();
      return;
    }

    // 実行中コマンドが無いのに来た応答(RSSI 等)はログのみ。
    if (resp.type !== 'rssi') {
      logger.debug('未処理の応答:', resp.raw);
    }
  }

  private finishPending(): void {
    if (this.pending?.timer) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  /**
   * コマンドを送信し、ハンドラが完了を判定するまで待つ。
   * cmdLock により直列化され、常に 1 コマンドのみ in-flight。
   */
  private sendCommand<T>(
    payload: Buffer,
    description: string,
    buildHandler: (
      resolve: (value: T) => void,
      reject: (err: Error) => void,
    ) => (resp: DeviceResponse) => boolean,
    timeoutMs: number,
  ): Promise<T> {
    const run = (): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const handle = buildHandler(resolve, reject);
        const timer = setTimeout(() => {
          if (this.pending && this.pending.description === description) {
            this.pending = null;
          }
          reject(new Error(`コマンド "${description}" がタイムアウトしました (${timeoutMs}ms)`));
        }, timeoutMs);

        this.pending = { description, handle, timer };
        logger.debug('TX:', description, payload.toString('utf8').replace(/\r\n$/, ''));
        this.port.write(payload, (err) => {
          if (err) {
            this.finishPending();
            reject(new Error(`書き込み失敗: ${err.message}`));
          }
        });
      });

    // 直前コマンドの完了後に実行(成否に関わらず連結)。
    const next = this.cmdLock.then(run, run);
    // チェーンが拒否で途切れないよう握りつぶした版を保持。
    this.cmdLock = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** 共通: *ER= を拒否に変換する補助。一致すれば true(=settled)。 */
  private static rejectOnError(resp: DeviceResponse, reject: (e: Error) => void): boolean {
    if (resp.type === 'error') {
      reject(new Error(`デバイスエラー: ${describeError(resp.code)}`));
      return true;
    }
    return false;
  }

  /**
   * テキストを無線送信する。*DT= 受理 → *IR=03 完了で解決。
   * *IR=01/02(センスエラー)や *ER= は拒否。
   */
  async transmit(text: string, mode?: ModeName): Promise<void> {
    if (mode) {
      const max = MAX_PAYLOAD[mode];
      const bytes = Buffer.byteLength(text, 'utf8');
      if (bytes > max) {
        throw new Error(`ペイロードが大きすぎます: ${bytes} バイト (${mode} の上限 ${max} バイト)`);
      }
    }
    await this.sendCommand<void>(
      cmd.transmit(text),
      'transmit',
      (resolve, reject) => (resp) => {
        if (SerialManager.rejectOnError(resp, reject)) return true;
        if (resp.type === 'txError') {
          reject(new Error(`送信失敗: ${resp.code === '01' ? 'キャリアセンス' : '相関センス'}エラー`));
          return true;
        }
        if (resp.type === 'txDone') {
          resolve();
          return true;
        }
        // *DT= ack は中間応答。継続。
        return false;
      },
      TX_TIMEOUT,
    );
  }

  /** ファームウェアバージョンを取得する。 */
  getVersion(): Promise<string> {
    return this.sendCommand<string>(
      cmd.getVersion(),
      'getVersion',
      (resolve, reject) => (resp) => {
        if (SerialManager.rejectOnError(resp, reject)) return true;
        if (resp.type === 'version') {
          resolve(resp.version);
          return true;
        }
        return false;
      },
      DEFAULT_TIMEOUT,
    );
  }

  /** 現在のチャンネルを取得する。 */
  getChannel(): Promise<number> {
    return this.sendCommand<number>(
      cmd.getChannel(),
      'getChannel',
      (resolve, reject) => (resp) => {
        if (SerialManager.rejectOnError(resp, reject)) return true;
        if (resp.type === 'channel') {
          resolve(resp.channel);
          return true;
        }
        return false;
      },
      DEFAULT_TIMEOUT,
    );
  }

  /** チャンネルを設定する(save=true で不揮発保存)。 */
  setChannel(channel: number, save = false): Promise<number> {
    return this.sendCommand<number>(
      cmd.setChannel(channel, save),
      'setChannel',
      (resolve, reject) => (resp) => {
        if (SerialManager.rejectOnError(resp, reject)) return true;
        if (resp.type === 'channel') {
          resolve(resp.channel);
          return true;
        }
        // *WR=PS は中間応答。継続。
        return false;
      },
      DEFAULT_TIMEOUT,
    );
  }

  /** 現在の通信モードを取得する。 */
  getMode(): Promise<number> {
    return this.sendCommand<number>(
      cmd.getMode(),
      'getMode',
      (resolve, reject) => (resp) => {
        if (SerialManager.rejectOnError(resp, reject)) return true;
        if (resp.type === 'mode') {
          resolve(resp.mode);
          return true;
        }
        return false;
      },
      DEFAULT_TIMEOUT,
    );
  }

  /** 通信モードを設定する(save=true で不揮発保存)。 */
  setMode(mode: ModeName, save = false): Promise<number> {
    const value = mode === 'FSK' ? MODE.FSK : MODE.LORA;
    return this.sendCommand<number>(
      cmd.setMode(value, save),
      'setMode',
      (resolve, reject) => (resp) => {
        if (SerialManager.rejectOnError(resp, reject)) return true;
        if (resp.type === 'mode') {
          resolve(resp.mode);
          return true;
        }
        // *WR=PS は中間応答。継続。
        return false;
      },
      DEFAULT_TIMEOUT,
    );
  }

  /** version / channel / mode をまとめて取得する(cmdLock で直列化)。 */
  async getStatus(): Promise<RadioStatus> {
    const [version, channel, mode] = await Promise.all([
      this.getVersion(),
      this.getChannel(),
      this.getMode(),
    ]);
    return { version, channel, mode, modeName: modeName(mode) };
  }
}
