/**
 * プラットフォーム依存のユーティリティ。
 *
 * シリアルポート名は OS ごとに異なる(Windows: COMx / Linux: /dev/ttyUSBx /
 * macOS: /dev/tty.usbserial-*)。環境変数 SERIAL_PORT が未指定のときに使う、
 * OS ごとの妥当な既定値を返す。
 */

/**
 * 実行中の OS に応じた既定のシリアルポート名を返す。
 * 実機の番号はマシンごとに変わるため、あくまで「それらしい初期値」。
 * 通常は環境変数 SERIAL_PORT または -p/--port で明示指定する。
 */
export function defaultSerialPort(): string {
  switch (process.platform) {
    case 'win32':
      return 'COM3';
    case 'darwin':
      return '/dev/tty.usbserial';
    default: // linux など
      return '/dev/ttyUSB0';
  }
}
