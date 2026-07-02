# radiogram — MLR-429 radio messaging CLI / MCP server

Relay text messages **between generative AIs** (MCP clients) over the USB-serial radio
**MLR-429** (429 MHz / LoRa・FSK / UART 19200 bps).

- **MCP server** … operate the radio from any MCP-capable client (Claude / Antigravity / Gemini CLI …).
- **Standalone CLI** … send / receive / query status directly from a terminal, without MCP.

Both modes ship as the same binary (`radiogram`): `radiogram serve` starts the MCP server; the
other subcommands are the direct CLI. Works on **Windows, Linux, and macOS**.

**English | [日本語](#日本語)**

> `#MCP` `#ModelContextProtocol` `#AI` `#LLM` `#Claude` `#GenerativeAI` `#AIAgents`
> `#SerialPort` `#LoRa` `#FSK` `#Radio` `#Wireless` `#MLR429` `#IoT` `#CircuitDesign`
> `#NodeJS` `#TypeScript` `#無線` `#生成AI`

---

## Hardware

- **MLR-429** low-power radio modem — <https://www.circuitdesign.jp/item/products/mlr-429/>
  (429 MHz, switchable LoRa / FSK, UART 19200 bps)
- A USB-Serial adapter connecting the MLR-429 to your PC.
- Driver & sample program: <https://github.com/circuitdesign-inc/MLR_Modem.git>

The MLR-429 is connected over USB-serial; the serial device name depends on your OS and
which USB port you use (see [Serial ports by OS](#serial-ports-by-os)).

## Setup

```bash
npm install
npm run build
```

> If the `serialport` native module is missing:
> `npm rebuild serialport --build-from-source`

To use the `radiogram` command globally (optional):

```bash
npm link        # or, from the project root:  npm i -g .
radiogram help
```

## Serial ports by OS

The serial device name differs per platform. Set it with `-p/--port` or the `SERIAL_PORT`
environment variable. If unset, a sensible OS default is used (but the actual number/name
varies per machine, so usually specify it explicitly).

| OS | Typical port names | How to find it |
|---|---|---|
| Windows | `COM3`, `COM44`, … | Device Manager → Ports (COM & LPT) |
| Linux | `/dev/ttyUSB0`, `/dev/ttyACM0` | `ls /dev/ttyUSB* /dev/ttyACM*` |
| macOS | `/dev/tty.usbserial-*`, `/dev/cu.usbserial-*` | `ls /dev/tty.* /dev/cu.*` |

> **Linux note:** accessing a serial port usually requires permission. Add your user to the
> `dialout` group (`sudo usermod -aG dialout $USER`, then log out/in), or run with elevated
> privileges.

## CLI usage

```bash
# Status (version / channel / mode)
radiogram -p /dev/ttyUSB0 status          # Linux
radiogram -p COM44 status                 # Windows

# Send text
radiogram -p /dev/ttyUSB0 send "hello"

# Send binary (base64)
radiogram -p /dev/ttyUSB0 send-binary "AAEC/w=="

# Receive one message (default 60 s wait; the radio is slow, so allow time)
radiogram -p /dev/ttyUSB0 recv -t 120000

# Receive one binary message (shown as base64 / hex)
radiogram -p /dev/ttyUSB0 recv-binary -t 120000

# Set channel / mode (-s persists to non-volatile memory)
radiogram -p /dev/ttyUSB0 set-channel 15 -s
radiogram -p /dev/ttyUSB0 set-mode LoRa -s

# Start as an MCP server (stdio)
radiogram serve
```

If you have not installed `radiogram` globally, `node dist/cli.js <subcommand>` is equivalent
(e.g. `node dist/cli.js -p /dev/ttyUSB0 status`).

### Subcommands / options

| Subcommand | Description |
|---|---|
| `serve` | Start the MCP server (stdio). Default when no subcommand is given. |
| `send "<text>"` | Transmit text over radio (waits for completion `*IR=03`). |
| `send-binary <base64>` | Transmit binary data over radio (base64 input). |
| `recv` | Receive one text message (default 60 s wait; exit code 2 on timeout). |
| `recv-binary` | Receive one binary message and print base64 / hex. |
| `status` | Show version / channel / mode. |
| `set-channel <n>` | Set the channel (`7`–`46`). |
| `set-mode <FSK\|LoRa>` | Set the communication mode. |
| `help` | Help. |

| Option | Default | Description |
|---|---|---|
| `-p, --port <port>` | `$SERIAL_PORT` or OS default | Serial port |
| `-b, --baud <bps>` | `$BAUD_RATE` or `19200` | Baud rate |
| `-t, --timeout <ms>` | `60000` | Wait time for `recv` |
| `-s, --save` | off | Persist setting to non-volatile memory (`/W`) |

> **Note:** A serial port can be opened by only one process. While the MCP server (`serve`)
> is running, you cannot run a separate CLI command against the same port (and vice versa).

## FSK / LoRa mode switching

The MLR-429 supports two communication modes, and radiogram can switch between them. Both peers
must use the **same** mode (and channel) to communicate.

| Mode | Device command | Max payload |
|---|---|---|
| FSK | `@MO01` | 60 bytes |
| LoRa | `@MO03` | 250 bytes |

Switch via the CLI or the MCP tool:

```bash
radiogram -p /dev/ttyUSB0 set-mode FSK         # switch to FSK  (@MO01)
radiogram -p /dev/ttyUSB0 set-mode LoRa        # switch to LoRa (@MO03)
radiogram -p /dev/ttyUSB0 set-mode LoRa -s     # ...and persist with /W
```

- From an MCP client, use the `set_mode` tool with `mode: "FSK" | "LoRa"` and optional `save`.
- Without `-s` / `save`, the mode change is volatile (resets on power cycle); with it, the
  radio stores the mode in non-volatile memory.
- The current mode is reported by `status` (CLI) and `get_radio_status` (MCP tool).

## Using as an MCP server (client registration)

MCP is a **client-independent** standard protocol. For any client, what you register is the
triple of **launch command + arguments + environment variables**. The common spec for this
server is:

```jsonc
{
  "command": "node",
  "args": ["/absolute/path/to/radiogram/dist/cli.js", "serve"],
  "env": { "SERIAL_PORT": "/dev/ttyUSB0", "BAUD_RATE": "19200" }
}
```

> Use an **absolute path** to `dist/cli.js`. On Windows that looks like
> `C:\\path\\to\\radiogram\\dist\\cli.js` and `SERIAL_PORT` like `COM44`.
> If installed globally, you can instead use `"command": "radiogram", "args": ["serve"]`.

Add this to each client's configuration.

### Claude Desktop

`%APPDATA%\Claude\claude_desktop_config.json` (Windows) or
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "radiogram": {
      "command": "node",
      "args": ["/absolute/path/to/radiogram/dist/cli.js", "serve"],
      "env": { "SERIAL_PORT": "/dev/ttyUSB0", "BAUD_RATE": "19200" }
    }
  }
}
```

### Claude Code (CLI)

```bash
# Linux / macOS
claude mcp add radiogram \
  --env SERIAL_PORT=/dev/ttyUSB0 --env BAUD_RATE=19200 \
  -- node /absolute/path/to/radiogram/dist/cli.js serve

# Windows
claude mcp add radiogram ^
  --env SERIAL_PORT=COM44 --env BAUD_RATE=19200 ^
  -- node C:\path\to\radiogram\dist\cli.js serve
```

### Google Antigravity

Add the same `mcpServers` block via Antigravity's **MCP settings** (Settings → MCP /
`mcp_config.json`). The key name is `mcpServers`, identical to other clients:

```json
{
  "mcpServers": {
    "radiogram": {
      "command": "node",
      "args": ["/absolute/path/to/radiogram/dist/cli.js", "serve"],
      "env": { "SERIAL_PORT": "/dev/ttyUSB0", "BAUD_RATE": "19200" }
    }
  }
}
```

### Gemini CLI

`~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "radiogram": {
      "command": "node",
      "args": ["/absolute/path/to/radiogram/dist/cli.js", "serve"],
      "env": { "SERIAL_PORT": "/dev/ttyUSB0", "BAUD_RATE": "19200" }
    }
  }
}
```

### Others (Cursor / Windsurf / Cline / VS Code, etc.)

All of them work by adding the common spec above under the `mcpServers` key (only the config
file location differs per tool).

## Demo: AI vs. AI "shiritori" word chain

Two radios (A / B) relay between **two AI CLIs playing shiritori over the air**. Each AI reads
the opponent's word and generates the next one, so it's immediately obvious the AIs are
responding autonomously. Words are short, which suits the low-rate RF link (≈240 bps).

```
[Claude Code] ─MCP→ radiogram(port A) ))) 429MHz LoRa ((( radiogram(port B) ←MCP─ [Antigravity]
   first player / terminal A                              second player / terminal B
```

> **Prerequisite:** close every other process holding ports A / B (link tests, other radiogram
> sessions), then run in **two fresh terminals**, since a serial port allows only one process.

### 0. Pass-through link check (non-AI, recommended)

```bash
# Terminal B (receiver; start first)
node /absolute/path/to/radiogram/dist/cli.js -p /dev/ttyUSB1 recv -t 120000
# Terminal A (sender)
node /absolute/path/to/radiogram/dist/cli.js -p /dev/ttyUSB0 send "ping"
```

If `ping` appears on side B, the link is OK. Close both processes afterward to free the ports.

### 1. Verify Antigravity sees radiogram

```bash
agy -p "List the available MCP tools"
```

If `send_message` / `receive_message` are visible, you're set. Otherwise, write the same
`mcpServers` block into `~/.gemini/settings.json` (same format as the Gemini CLI section
above, with `SERIAL_PORT` set to side B's port).

### 2. Start the game (always start the second player B first)

**Start terminal B (second player / Antigravity / port B) first** — it waits for the opponent's word:

```bash
agy --dangerously-skip-permissions -i "You are the second player in shiritori. Use only radiogram's receive_message and send_message tools to play shiritori with the other AI over radio. Rules: (1) first receive_message(timeoutMs:120000) to get the opponent's word. (2) think of a Japanese word that starts with the last kana of the received word. (3) send it with send_message. (4) words ending in 'ん' are forbidden. (5) after 5 receive→send round trips, finally send only 'END' with send_message and stop. (6) each turn, print 'received word → my word'. If the opponent sends 'END', stop immediately."
```

**Then start terminal A (first player / Claude Code / port A)** — it sends the first word:

```bash
claude --dangerously-skip-permissions "You are the first player in shiritori. Use only radiogram's send_message and receive_message tools to play shiritori with the other AI over radio. Rules: (1) first send one Japanese word with send_message (e.g. しりとり). (2) then receive_message(timeoutMs:120000) to get the opponent's word. (3) think of another word starting with the last kana of the received word and send it with send_message. (4) words ending in 'ん' are forbidden. (5) stop after 5 send→receive round trips. If the opponent sends 'END', stop immediately. (6) each turn, print 'my word → received word'."
```

Both screens show words alternating, with the AIs playing shiritori across the radio link.

### Troubleshooting the demo

- **Antigravity won't load MCP** … run both sides with Claude Code. For side B add an alias:
  `claude mcp add radiogram-b --env SERIAL_PORT=/dev/ttyUSB1 --env BAUD_RATE=19200 -- node /absolute/path/to/radiogram/dist/cli.js serve`, and use it in terminal B.
- **Turns desync / stall** … reduce round trips 5→3 and raise `timeoutMs` to 180000.
- **Guaranteed demo (no AI)** … type `recv` / `send` by hand on both sides, alternating, to
  reproduce shiritori manually.

## MCP tools provided

| Tool | Arguments | Description |
|---|---|---|
| `send_message` | `text` | Transmit text over radio (waits for completion). |
| `send_binary` | `base64` | Transmit binary data over radio (base64 input). |
| `receive_message` | `timeoutMs?` | Dequeue one received text message (default 30000 ms). |
| `receive_binary` | `timeoutMs?` | Dequeue one received binary message as base64 / hex. |
| `get_radio_status` | none | Get version / channel / mode. |
| `set_channel` | `channel`, `save?` | Set the channel (`7`–`46`). |
| `set_mode` | `mode` (FSK/LoRa), `save?` | Switch communication mode. |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `SERIAL_PORT` | OS default (`COM3` / `/dev/ttyUSB0` / `/dev/tty.usbserial`) | Serial port |
| `BAUD_RATE` | `19200` | Baud rate |
| `LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` (all logs go to stderr) |

## Test scripts (real hardware)

```bash
# Single-port status / send / receive
SERIAL_PORT=/dev/ttyUSB0 npm run test:serial
SERIAL_PORT=/dev/ttyUSB0 npm run test:serial -- send "hello"
SERIAL_PORT=/dev/ttyUSB0 npm run test:serial -- recv 60000

# Two-radio bidirectional loopback test
PORT_A=/dev/ttyUSB0 PORT_B=/dev/ttyUSB1 RX_TIMEOUT=60000 npm run test:twoport

# Raw byte diagnostics / baud-rate scan (to isolate a non-responsive link)
PORT=/dev/ttyUSB0 npm run probe
PORT=/dev/ttyUSB0 BAUD_SCAN=1 npm run probe
```

> On Windows PowerShell, instead of `SERIAL_PORT=COM44 ...` use
> `$env:SERIAL_PORT="COM44"; ...`.

## MLR-429 protocol summary

- TX: `@DT<LL><data>\r\n` → `*DT=<LL>` (accepted) → `*IR=03` (done)
- RX: `*DR=<LL><data>\r\n` (LL = data byte count in hex, length-prefixed)
- Channel: `@CH<XX>[/W]\r\n` → `*CH=<XX>` (valid range: `7`–`46`)
- Mode: `@MO<XX>[/W]\r\n` → `*MO=<XX>` (FSK=01 / LoRa=03)
- Version: `@VR\r\n` → `*VR=<string>`
- Errors: `*ER=01`–`05`; TX failures `*IR=01` (carrier sense) / `*IR=02` (correlation sense)

## License

[MIT](LICENSE) © Circuit Design, Inc.

## Topics

`#MCP` `#ModelContextProtocol` `#AI` `#LLM` `#Claude` `#GenerativeAI` `#AIAgents`
`#SerialPort` `#LoRa` `#FSK` `#Radio` `#Wireless` `#MLR429` `#IoT` `#CircuitDesign`
`#NodeJS` `#TypeScript`

---

<a id="日本語"></a>

# 日本語

USB シリアル接続の無線機 **MLR-429**(429MHz / LoRa・FSK / UART 19200bps)を介して、
生成AI(MCP クライアント)間でテキストメッセージを交信させるツール。

- **MCP サーバー** … Claude / Antigravity / Gemini CLI など MCP 対応クライアントから無線機を操作。
- **スタンドアロン CLI** … MCP を介さずターミナルから直接 送信 / 受信 / 状態取得。

両者は同じバイナリ(`radiogram`)で、`radiogram serve` が MCP サーバー、その他のサブコマンドが直接 CLI です。
**Windows / Linux / macOS** で動作します。

## ハードウェア

- **MLR-429** 特定小電力無線モデム — <https://www.circuitdesign.jp/item/products/mlr-429/>
  (429MHz / LoRa・FSK 切替 / UART 19200bps)
- MLR-429 を PC に接続する USB-シリアル変換。
- ドライバ & サンプル: <https://github.com/circuitdesign-inc/MLR_Modem.git>

MLR-429 は USB シリアルで PC に接続します。シリアルポート名は OS と接続する USB ポートに
よって変わります([OS ごとのシリアルポート](#os-ごとのシリアルポート)参照)。

## セットアップ

```bash
npm install
npm run build
```

> serialport のネイティブモジュールが見つからない場合:
> `npm rebuild serialport --build-from-source`

グローバルに `radiogram` コマンドを使いたい場合(任意):

```bash
npm link        # またはプロジェクト直下で  npm i -g .
radiogram help
```

## OS ごとのシリアルポート

シリアルデバイス名は OS により異なります。`-p/--port` または環境変数 `SERIAL_PORT` で指定
します。未指定なら OS ごとの妥当な既定値が使われますが、実際の番号/名前はマシンごとに変わる
ため、通常は明示指定してください。

| OS | 代表的なポート名 | 確認方法 |
|---|---|---|
| Windows | `COM3`, `COM44`, … | デバイスマネージャー → ポート (COM と LPT) |
| Linux | `/dev/ttyUSB0`, `/dev/ttyACM0` | `ls /dev/ttyUSB* /dev/ttyACM*` |
| macOS | `/dev/tty.usbserial-*`, `/dev/cu.usbserial-*` | `ls /dev/tty.* /dev/cu.*` |

> **Linux の注意:** シリアルポートのアクセスには権限が必要です。ユーザーを `dialout` グループ
> に追加(`sudo usermod -aG dialout $USER` 後に再ログイン)するか、権限を付けて実行します。

## CLI として使う

```bash
# 状態取得(バージョン / チャンネル / モード)
radiogram -p /dev/ttyUSB0 status      # Linux
radiogram -p COM44 status             # Windows

# テキスト送信
radiogram -p /dev/ttyUSB0 send "hello"

# バイナリ送信(base64)
radiogram -p /dev/ttyUSB0 send-binary "AAEC/w=="

# 受信(1件、既定60秒待機。無線が低速なので長め)
radiogram -p /dev/ttyUSB0 recv -t 120000

# バイナリ受信(base64 / hex 表示)
radiogram -p /dev/ttyUSB0 recv-binary -t 120000

# チャンネル / モード設定(-s で不揮発保存)
radiogram -p /dev/ttyUSB0 set-channel 15 -s
radiogram -p /dev/ttyUSB0 set-mode LoRa -s

# MCP サーバーとして起動(stdio)
radiogram serve
```

`radiogram` を入れていない場合は `node dist/cli.js <subcommand>` でも同じです
(例: `node dist/cli.js -p /dev/ttyUSB0 status`)。

### サブコマンド / オプション

| サブコマンド | 説明 |
|---|---|
| `serve` | MCP サーバーを起動 (stdio)。引数なしの既定もこれ |
| `send "<text>"` | テキストを無線送信(送信完了 `*IR=03` まで待機) |
| `send-binary <base64>` | バイナリデータを無線送信(base64 入力) |
| `recv` | テキストメッセージを1件受信(既定60秒待機、タイムアウト時 exit code 2) |
| `recv-binary` | バイナリメッセージを1件受信し base64 / hex で表示 |
| `status` | バージョン / チャンネル / モードを表示 |
| `set-channel <n>` | チャンネル設定(`7`〜`46`) |
| `set-mode <FSK\|LoRa>` | 通信モード設定 |
| `help` | ヘルプ |

| オプション | 既定 | 説明 |
|---|---|---|
| `-p, --port <port>` | `$SERIAL_PORT` または OS 既定 | シリアルポート |
| `-b, --baud <bps>` | `$BAUD_RATE` または `19200` | ボーレート |
| `-t, --timeout <ms>` | `60000` | `recv` の待機ミリ秒 |
| `-s, --save` | off | 設定を不揮発メモリに保存(`/W`) |

> **注意:** シリアルポートは1プロセスしか開けません。MCP サーバー(`serve`)を起動中は、
> 同じポートに対して別途 CLI コマンドを実行できません(逆も同様)。

## FSK / LoRa の通信モード切替

MLR-429 は2つの通信モードを持ち、radiogram で切り替えられます。交信するには両機が **同じ** モード
(およびチャンネル)である必要があります。

| モード | デバイスコマンド | 最大ペイロード |
|---|---|---|
| FSK | `@MO01` | 60 バイト |
| LoRa | `@MO03` | 250 バイト |

CLI または MCP ツールで切り替えます:

```bash
radiogram -p /dev/ttyUSB0 set-mode FSK         # FSK へ切替  (@MO01)
radiogram -p /dev/ttyUSB0 set-mode LoRa        # LoRa へ切替 (@MO03)
radiogram -p /dev/ttyUSB0 set-mode LoRa -s     # /W で不揮発保存も行う
```

- MCP クライアントからは `set_mode` ツールを `mode: "FSK" | "LoRa"` と任意の `save` で使用。
- `-s` / `save` なしの場合、モード変更は揮発(電源再投入でリセット)。付けると無線機が不揮発
  メモリに保存します。
- 現在のモードは `status`(CLI)/ `get_radio_status`(MCP ツール)で確認できます。

## MCP サーバーとして使う(各種クライアント登録)

MCP は **クライアント非依存** の標準プロトコルです。どのクライアントでも、登録する中身は
「**起動コマンド + 引数 + 環境変数**」の組です。本サーバーの共通スペックは次の通り:

```jsonc
{
  "command": "node",
  "args": ["/absolute/path/to/radiogram/dist/cli.js", "serve"],
  "env": { "SERIAL_PORT": "/dev/ttyUSB0", "BAUD_RATE": "19200" }
}
```

> `dist/cli.js` は **絶対パス** で指定します。Windows では
> `C:\\path\\to\\radiogram\\dist\\cli.js`、`SERIAL_PORT` は `COM44` のようになります。
> グローバル導入済みなら `"command": "radiogram", "args": ["serve"]` でも可。

これを各クライアントの設定に入れます。

### Claude Desktop

`%APPDATA%\Claude\claude_desktop_config.json`(Windows)または
`~/Library/Application Support/Claude/claude_desktop_config.json`(macOS):

```json
{
  "mcpServers": {
    "radiogram": {
      "command": "node",
      "args": ["/absolute/path/to/radiogram/dist/cli.js", "serve"],
      "env": { "SERIAL_PORT": "/dev/ttyUSB0", "BAUD_RATE": "19200" }
    }
  }
}
```

### Claude Code(CLI)

```bash
# Linux / macOS
claude mcp add radiogram \
  --env SERIAL_PORT=/dev/ttyUSB0 --env BAUD_RATE=19200 \
  -- node /absolute/path/to/radiogram/dist/cli.js serve

# Windows
claude mcp add radiogram ^
  --env SERIAL_PORT=COM44 --env BAUD_RATE=19200 ^
  -- node C:\path\to\radiogram\dist\cli.js serve
```

### Google Antigravity

Antigravity の **MCP 設定**(設定 → MCP / `mcp_config.json`)に、同じ `mcpServers` 形式で
追加します。キー名は他クライアントと同じ `mcpServers` です:

```json
{
  "mcpServers": {
    "radiogram": {
      "command": "node",
      "args": ["/absolute/path/to/radiogram/dist/cli.js", "serve"],
      "env": { "SERIAL_PORT": "/dev/ttyUSB0", "BAUD_RATE": "19200" }
    }
  }
}
```

### Gemini CLI

`~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "radiogram": {
      "command": "node",
      "args": ["/absolute/path/to/radiogram/dist/cli.js", "serve"],
      "env": { "SERIAL_PORT": "/dev/ttyUSB0", "BAUD_RATE": "19200" }
    }
  }
}
```

### その他(Cursor / Windsurf / Cline / VS Code 等)

いずれも `mcpServers` キーに上記の共通スペックを追加すれば動作します(設定ファイルの場所のみ
各ツール依存)。

## デモ:AI同士の「しりとり対決」

2台の無線機(A / B)を介して、**Claude Code CLI と Antigravity CLI が無線越しにしりとり**を
するデモ。各AIが相手の単語を理解して次の単語を生成するため、AIが自律応答していることが一目で
伝わる。単語=短文なので低速RF(≈240bps)にも最適。

```
[Claude Code] ─MCP→ radiogram(ポートA) ))) 429MHz LoRa ((( radiogram(ポートB) ←MCP─ [Antigravity]
   先攻 / ターミナルA                                          後攻 / ターミナルB
```

> **前提:** ポート A / B を掴んでいる他プロセス(疎通テスト用 `node` や、radiogram をロード済みの
> 別セッション)は全て閉じてから、**新規ターミナル2枚**で実施する。シリアルは1プロセスしか
> 開けないため。

### 0. 無線リンクの素通し確認(非AI・推奨)

```bash
# ターミナルB(受信・先に起動)
node /absolute/path/to/radiogram/dist/cli.js -p /dev/ttyUSB1 recv -t 120000
# ターミナルA(送信)
node /absolute/path/to/radiogram/dist/cli.js -p /dev/ttyUSB0 send "ping"
```

B 側に `ping` が出ればリンクOK。確認後は両プロセスを閉じてポートを解放する。

### 1. Antigravity が radiogram を認識しているか確認

```bash
agy -p "利用可能なMCPツールを一覧にして"
```

`send_message` / `receive_message` が見えればOK。見えない場合は `~/.gemini/settings.json` に
同じ `mcpServers` ブロックを書く(上記「Gemini CLI」節と同形式、`SERIAL_PORT` は B 側ポート)。

### 2. しりとり開始(必ず後攻=B を先に起動)

**ターミナルB(後攻 / Antigravity / ポートB)を先に起動**(相手の単語待ちで待機):

```bash
agy --dangerously-skip-permissions -i "あなたはしりとりの後攻プレイヤーです。radiogram の receive_message と send_message ツールだけを使い、無線で相手AIとしりとりをします。ルール:(1)まず receive_message(timeoutMs:120000) で相手の単語を受け取る。(2)受け取った単語の最後のかな文字から始まる、別の日本語の単語を考える。(3)それを send_message で送る。(4)語尾が『ん』になる単語は禁止。(5)受信→送信を5往復したら、最後に send_message で『END』だけを送って終了する。(6)毎ターン『受信した単語 → 自分が送る単語』を画面に表示する。相手から『END』が来たら即終了。"
```

**ターミナルA(先攻 / Claude Code / ポートA)を起動**(最初の単語を送る):

```bash
claude --dangerously-skip-permissions "あなたはしりとりの先攻プレイヤーです。radiogram の send_message と receive_message ツールだけを使い、無線で相手AIとしりとりをします。ルール:(1)まず好きな日本語の単語を1つ send_message で送る(例:しりとり)。(2)その後 receive_message(timeoutMs:120000) で相手の単語を受け取る。(3)受け取った単語の最後のかな文字から始まる別の単語を考えて send_message で送る。(4)語尾が『ん』になる単語は禁止。(5)送信→受信を5往復したら終了。相手から『END』が来たら即終了。(6)毎ターン『自分が送る単語 → 受信した単語』を画面に表示する。"
```

両画面に単語のやり取りが交互に表示され、無線越しにAI同士がしりとりを進める。

### うまくいかないとき

- **Antigravity が MCP を読まない** … 両側とも Claude Code で実行する。B 側ポート用に別名登録
  `claude mcp add radiogram-b --env SERIAL_PORT=/dev/ttyUSB1 --env BAUD_RATE=19200 -- node /absolute/path/to/radiogram/dist/cli.js serve` を追加し、B 側ターミナルで使う。
- **手番がずれる / 止まる** … 往復回数を 5→3 に、`timeoutMs` を 180000 に増やす。
- **確実に見せたい(AIなし)** … 両側 `recv` / `send` を人手で交互に打ち、しりとりを手動再現。

## 提供する MCP ツール

| ツール | 引数 | 説明 |
|---|---|---|
| `send_message` | `text` | テキストを無線送信(送信完了まで待機) |
| `send_binary` | `base64` | バイナリデータを無線送信(base64 入力) |
| `receive_message` | `timeoutMs?` | 受信テキストメッセージを 1 件取り出す(既定 30000ms) |
| `receive_binary` | `timeoutMs?` | 受信バイナリメッセージを base64 / hex で取り出す |
| `get_radio_status` | なし | バージョン / チャンネル / モードを取得 |
| `set_channel` | `channel`, `save?` | チャンネル設定(`7`〜`46`) |
| `set_mode` | `mode`(FSK/LoRa), `save?` | 通信モード切替 |

## 環境変数

| 変数 | 既定 | 説明 |
|---|---|---|
| `SERIAL_PORT` | OS 既定(`COM3` / `/dev/ttyUSB0` / `/dev/tty.usbserial`) | シリアルポート |
| `BAUD_RATE` | `19200` | ボーレート |
| `LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error`(ログは全て stderr) |

## 実機テスト用スクリプト

```bash
# 単一ポートの状態取得 / 送信 / 受信
SERIAL_PORT=/dev/ttyUSB0 npm run test:serial
SERIAL_PORT=/dev/ttyUSB0 npm run test:serial -- send "hello"
SERIAL_PORT=/dev/ttyUSB0 npm run test:serial -- recv 60000

# 2台折り返しの双方向送受信テスト
PORT_A=/dev/ttyUSB0 PORT_B=/dev/ttyUSB1 RX_TIMEOUT=60000 npm run test:twoport

# 生バイト診断 / ボーレートスキャン(無応答時の切り分け用)
PORT=/dev/ttyUSB0 npm run probe
PORT=/dev/ttyUSB0 BAUD_SCAN=1 npm run probe
```

PowerShell では `SERIAL_PORT=COM44 ...` の代わりに `$env:SERIAL_PORT="COM44"; ...` とします。

## MLR-429 プロトコル要点

- 送信: `@DT<LL><data>\r\n` → `*DT=<LL>`(受理)→ `*IR=03`(完了)
- 受信: `*DR=<LL><data>\r\n`(LL = データのバイト数16進、長さプレフィックス付き)
- チャンネル: `@CH<XX>[/W]\r\n` → `*CH=<XX>`
- モード: `@MO<XX>[/W]\r\n` → `*MO=<XX>`(FSK=01 / LoRa=03)
- バージョン: `@VR\r\n` → `*VR=<string>`
- エラー: `*ER=01`〜`05`、送信失敗 `*IR=01`(キャリアセンス)/`*IR=02`(相関センス)

## ライセンス

[MIT](LICENSE) © Circuit Design, Inc.

## トピック / ハッシュタグ

`#MCP` `#ModelContextProtocol` `#AI` `#LLM` `#Claude` `#生成AI` `#AIエージェント`
`#SerialPort` `#LoRa` `#FSK` `#無線` `#Wireless` `#MLR429` `#IoT` `#特定小電力無線`
`#CircuitDesign` `#NodeJS` `#TypeScript`
