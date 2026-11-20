import { spawn } from 'node:child_process';
import { color } from './color.js';

/**
 * Opens a URL in the default browser, without waiting for it. A failure is only logged, since the URL is printed too.
 * @param url The page to open.
 */
export function openBrowser(url: string): void {
  const [command, ...args] =
    process.platform === 'win32'
      ? ['cmd', '/c', 'start', '""', url]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', url];
  try {
    const child = spawn(command ?? 'xdg-open', args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', (error) => console.log(color.Gray(`Could not open a browser: ${error.message}`)));
    child.unref();
  } catch (error) {
    console.log(color.Gray(`Could not open a browser: ${String(error)}`));
  }
}
