/**
 * MCP サーバー本体。stdio トランスポートで JSON-RPC を話す。
 *
 * stdout は MCP 専用のため、ログはすべて stderr(logger 経由)に出す。
 * CLI(`radiogram serve`)と既存エントリ(`node dist/index.js`)の両方から使う。
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { SerialManager } from './serial/SerialManager.js';
import { createHandlers } from './mcp/handlers.js';
import { TOOL_DEFINITIONS } from './mcp/tools.js';
import { logger } from './utils/logger.js';

export interface ServerOptions {
  port: string;
  baud: number;
}

/** MCP サーバーを起動し、stdio で待ち受ける。 */
export async function startMcpServer(opts: ServerOptions): Promise<void> {
  const serial = new SerialManager({ path: opts.port, baudRate: opts.baud });
  const handlers = createHandlers(serial);

  const server = new Server(
    { name: 'radiogram', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((t) => ({ ...t })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = handlers[name];
    if (!handler) {
      return {
        content: [{ type: 'text', text: `未知のツール: ${name}` }],
        isError: true,
      };
    }
    try {
      return await handler(args ?? {});
    } catch (err) {
      logger.error(`ツール ${name} の実行エラー:`, (err as Error).message);
      return {
        content: [{ type: 'text', text: `エラー: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  // シリアルポートを開く。失敗しても起動はするが警告を出す。
  try {
    await serial.open();
  } catch (err) {
    logger.error('シリアルポート初期化失敗:', (err as Error).message);
    logger.error('SERIAL_PORT 環境変数を確認してください(現在:', opts.port, ')');
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`radiogram サーバー起動完了(stdio, port=${opts.port} @ ${opts.baud}bps)`);

  // 終了処理。
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} 受信、シャットダウンします`);
    await serial.close();
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
