/**
 * MCP ツールのハンドラ群。SerialManager を介して無線機を操作する。
 */
import type { SerialManager } from '../serial/SerialManager.js';
import { QueueTimeoutError } from '../utils/MessageQueue.js';
import {
  SendMessageInput,
  ReceiveMessageInput,
  SetChannelInput,
  SetModeInput,
} from './tools.js';

export type ToolResult = {
  // SDK の ServerResult(インデックスシグネチャ付き)へ代入可能にするため index signature を持たせる。
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

type Handler = (args: unknown) => Promise<ToolResult>;

function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function fail(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** SerialManager を束ねたツールハンドラの map を生成する。 */
export function createHandlers(serial: SerialManager): Record<string, Handler> {
  return {
    send_message: async (args) => {
      const { text } = SendMessageInput.parse(args);
      try {
        await serial.transmit(text);
        return ok(`送信完了: "${text}"`);
      } catch (err) {
        return fail(`送信失敗: ${(err as Error).message}`);
      }
    },

    receive_message: async (args) => {
      const { timeoutMs } = ReceiveMessageInput.parse(args);
      try {
        const message = await serial.rfReceiveQueue.dequeue(timeoutMs);
        return ok(message);
      } catch (err) {
        if (err instanceof QueueTimeoutError) {
          return ok('(受信メッセージなし: タイムアウト)');
        }
        return fail(`受信失敗: ${(err as Error).message}`);
      }
    },

    get_radio_status: async () => {
      try {
        const status = await serial.getStatus();
        return ok(
          [
            `バージョン: ${status.version}`,
            `チャンネル: ${status.channel} (0x${status.channel.toString(16).toUpperCase()})`,
            `モード: ${status.modeName} (0x${status.mode.toString(16).toUpperCase().padStart(2, '0')})`,
          ].join('\n'),
        );
      } catch (err) {
        return fail(`状態取得失敗: ${(err as Error).message}`);
      }
    },

    set_channel: async (args) => {
      const { channel, save } = SetChannelInput.parse(args);
      try {
        const result = await serial.setChannel(channel, save);
        return ok(`チャンネルを ${result} に設定しました${save ? '(保存済み)' : ''}`);
      } catch (err) {
        return fail(`チャンネル設定失敗: ${(err as Error).message}`);
      }
    },

    set_mode: async (args) => {
      const { mode, save } = SetModeInput.parse(args);
      try {
        const result = await serial.setMode(mode, save);
        const name = result === 0x01 ? 'FSK' : result === 0x03 ? 'LoRa' : `0x${result.toString(16)}`;
        return ok(`通信モードを ${name} に設定しました${save ? '(保存済み)' : ''}`);
      } catch (err) {
        return fail(`モード設定失敗: ${(err as Error).message}`);
      }
    },
  };
}
