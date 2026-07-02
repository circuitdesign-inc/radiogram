/**
 * MCP ツールの入力スキーマ(Zod)とツールメタ定義。
 */
import { z } from 'zod';
import { MAX_CHANNEL, MIN_CHANNEL } from '../serial/protocol.js';

const Base64Payload = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      return Buffer.from(value, 'base64').toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '');
    } catch {
      return false;
    }
  }, '有効な base64 文字列を指定してください');

export const SendMessageInput = z.object({
  text: z.string().min(1).describe('無線で送信するテキスト'),
});

export const SendBinaryInput = z.object({
  base64: Base64Payload.describe('無線で送信するバイナリデータ(base64)'),
});

export const ReceiveMessageInput = z.object({
  timeoutMs: z
    .number()
    .int()
    .min(0)
    .max(600000)
    .default(30000)
    .describe('受信待機の最大ミリ秒。0 で即時(キューにあれば返す)。既定 30000'),
});

export const ReceiveBinaryInput = ReceiveMessageInput;

export const GetRadioStatusInput = z.object({});

export const SetChannelInput = z.object({
  channel: z
    .number()
    .int()
    .min(MIN_CHANNEL)
    .max(MAX_CHANNEL)
    .describe(`チャンネル番号(${MIN_CHANNEL}〜${MAX_CHANNEL})`),
  save: z.boolean().default(false).describe('true で不揮発メモリに保存(/W)'),
});

export const SetModeInput = z.object({
  mode: z.enum(['FSK', 'LoRa']).describe('通信モード'),
  save: z.boolean().default(false).describe('true で不揮発メモリに保存(/W)'),
});

/** JSON Schema を ListTools 応答に載せるための簡易定義。 */
export const TOOL_DEFINITIONS = [
  {
    name: 'send_message',
    description:
      'MLR-429 無線機でテキストメッセージを送信する。送信完了(*IR=03)まで待機する。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '無線で送信するテキスト' },
      },
      required: ['text'],
    },
  },
  {
    name: 'send_binary',
    description:
      'MLR-429 無線機でバイナリデータを送信する。入力は base64。送信完了(*IR=03)まで待機する。',
    inputSchema: {
      type: 'object',
      properties: {
        base64: { type: 'string', description: '無線で送信するバイナリデータ(base64)' },
      },
      required: ['base64'],
    },
  },
  {
    name: 'receive_message',
    description:
      '無線で届いたメッセージを 1 件テキストとして受信する。キューが空なら timeoutMs まで待機する。',
    inputSchema: {
      type: 'object',
      properties: {
        timeoutMs: {
          type: 'number',
          description: '受信待機の最大ミリ秒(既定 30000、0 で即時)',
        },
      },
    },
  },
  {
    name: 'receive_binary',
    description:
      '無線で届いたメッセージを 1 件バイナリとして受信し、base64 と hex で返す。',
    inputSchema: {
      type: 'object',
      properties: {
        timeoutMs: {
          type: 'number',
          description: '受信待機の最大ミリ秒(既定 30000、0 で即時)',
        },
      },
    },
  },
  {
    name: 'get_radio_status',
    description: '無線機の状態(ファームウェアバージョン・チャンネル・通信モード)を取得する。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_channel',
    description: '無線機のチャンネルを設定する。',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'number', description: `チャンネル番号(${MIN_CHANNEL}〜${MAX_CHANNEL})` },
        save: { type: 'boolean', description: 'true で不揮発保存' },
      },
      required: ['channel'],
    },
  },
  {
    name: 'set_mode',
    description: '無線機の通信モード(FSK / LoRa)を設定する。',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['FSK', 'LoRa'], description: '通信モード' },
        save: { type: 'boolean', description: 'true で不揮発保存' },
      },
      required: ['mode'],
    },
  },
] as const;
