import { createReadStream } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve } from 'node:path';
import { color } from './color.js';
import { readFileNames } from './fs-helpers.js';
import { policyFolderPattern, projectRoot } from './output-paths.js';
import { listViewerPolicies, readViewerPolicyDetail } from './viewer-data.js';

/** Where the viewer server reads from and listens. */
export interface ViewerServerOptions {
  /** Folder holding the policy folders. */
  root: string;
  /** Port on 127.0.0.1; 0 picks a free one. */
  port: number;
  /** The run's name and environment, shown in the page's header. */
  run: { runName?: string; environment?: string };
  /** Folder of the page's own files (default: `src/viewer` in this project, used from both `src/` and `dist/`). */
  staticDir?: string;
}

/** A running viewer server. */
export interface ViewerServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** The only address the viewer listens on, so the customer test data it serves is not reachable from other machines. */
const host = '127.0.0.1';

/** The page's own files, by the path they are served at. */
const staticFiles: Readonly<Record<string, string>> = {
  '/': 'index.html',
  '/viewer.css': 'viewer.css',
  '/viewer.js': 'viewer.js'
};

const contentTypes: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png'
};

/**
 * Starts the read-only viewer server: the page, the run's policies as JSON, and the files directly inside each policy
 * folder. Every request reads the output folder again, so results written during a run appear on refresh.
 * @param options Folder, port and run to serve.
 * @returns The server's URL and port, and a function that stops it.
 * @throws `Port <n> is in use; pass --port` when the port is taken, or the listen error otherwise.
 */
export async function startViewerServer(options: ViewerServerOptions): Promise<ViewerServer> {
  const root = resolve(options.root);
  const staticDir = options.staticDir ?? join(projectRoot, 'src', 'viewer');
  // The port is known only once listening (port 0 picks one); requests arrive after that
  let port = options.port;
  const server = createServer((request, response) => {
    handleRequest(request, response, { ...options, root, staticDir, port }).catch((error: unknown) => {
      console.error(color.Red(`Viewer: ${request.url ?? ''} failed: ${String(error)}`));
      if (!response.headersSent) {
        send(response, 500, 'text/plain; charset=utf-8', 'Internal error');
      } else {
        response.destroy();
      }
    });
  });
  await listen(server, options.port);
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://${host}:${port}/`,
    port,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose()).closeAllConnections())
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: Required<ViewerServerOptions>
): Promise<void> {
  if (!isOwnHost(request.headers.host, options.port)) {
    send(response, 403, 'text/plain; charset=utf-8', 'Forbidden');
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    send(response, 405, 'text/plain; charset=utf-8', 'Method not allowed');
    return;
  }

  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const staticFile = staticFiles[pathname];
  if (staticFile !== undefined) {
    await sendFile(response, options.staticDir, staticFile);
    return;
  }

  const segments = decodeSegments(pathname);
  if (segments?.[0] === 'api' && segments[1] === 'policies' && segments.length === 2) {
    sendJson(response, await listViewerPolicies(options.root, options.run));
  } else if (segments?.[0] === 'api' && segments[1] === 'policies' && segments.length === 3) {
    const detail = await readViewerPolicyDetail(options.root, segments[2] ?? '');
    if (detail === undefined) {
      sendNotFound(response);
    } else {
      sendJson(response, detail);
    }
  } else if (segments?.[0] === 'files' && segments.length === 3) {
    await sendPolicyFile(response, options.root, segments[1] ?? '', segments[2] ?? '');
  } else {
    sendNotFound(response);
  }
}

/**
 * True when a request names this server as its host. Binding to 127.0.0.1 keeps other machines out, but a web page the
 * user visits could point its own domain at 127.0.0.1 (DNS rebinding) and read the data; its requests carry that
 * domain as their Host, so only this server's own names are answered.
 */
function isOwnHost(hostHeader: string | undefined, port: number): boolean {
  return hostHeader === `${host}:${port}` || hostHeader === `localhost:${port}`;
}

/**
 * Splits a request path into decoded segments, or `undefined` when a segment cannot be decoded or decodes to a path
 * of its own (`.`, `..`, or one holding a slash or backslash), so no request can name a file outside its folder.
 */
function decodeSegments(pathname: string): string[] | undefined {
  const segments: string[] = [];
  for (const raw of pathname.split('/').slice(1)) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return undefined;
    }

    if (segment === '' || segment === '.' || segment === '..' || /[\\/:\0]/.test(segment)) {
      return undefined;
    }

    segments.push(segment);
  }

  return segments;
}

/** Sends a file only when it is a regular file directly inside a policy folder of the output folder. */
async function sendPolicyFile(response: ServerResponse, root: string, folder: string, file: string): Promise<void> {
  if (!policyFolderPattern.test(folder) || !(await readFileNames(join(root, folder))).includes(file)) {
    sendNotFound(response);
    return;
  }

  await sendFile(response, join(root, folder), file);
}

async function sendFile(response: ServerResponse, directory: string, file: string): Promise<void> {
  if (!(await readFileNames(directory)).includes(file)) {
    sendNotFound(response);
    return;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': contentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream'
  });
  if (response.req.method === 'HEAD') {
    response.end();
    return;
  }

  await new Promise<void>((resolveSent, reject) => {
    createReadStream(join(directory, file)).on('error', reject).pipe(response).on('finish', resolveSent);
  });
}

function sendJson(response: ServerResponse, value: unknown): void {
  send(response, 200, contentTypes['.json'] ?? 'application/json', JSON.stringify(value));
}

function sendNotFound(response: ServerResponse): void {
  send(response, 404, 'text/plain; charset=utf-8', 'Not found');
}

function send(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': contentType });
  response.end(response.req.method === 'HEAD' ? undefined : body);
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolveListen, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'EADDRINUSE' ? new Error(`Port ${port} is in use; pass --port`) : error);
    });
    server.listen(port, host, () => resolveListen());
  });
}
