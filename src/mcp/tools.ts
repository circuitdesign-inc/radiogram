/**
 * MCP ツールの入力スキーマ(Zod)とツールメタ定義。
 */
import { z } from 'zod';

export const SendMessageInput = z.object({
  text: z.string().min(1).describe('無線で送信するテキスト'),
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

export const GetRadioStatusInput = z.object({});

export const SetChannelInput = z.object({
  channel: z.number().int().min(7).max(255).describe('チャンネル番号(7〜255、機種の有効範囲内)'),
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
    name: 'receive_message',
    description:
      '無線で届いたメッセージを 1 件受信する。キューが空なら timeoutMs まで待機する。',
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
        channel: { type: 'number', description: 'チャンネル番号(7〜255)' },
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
