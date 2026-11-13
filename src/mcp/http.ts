// Stateless Streamable HTTP (MCP 2025-03-26 / 2025-06-18), using only Node's standard library.
// No client session owns a graph: all clients share the registered snapshots, reloaded on demand.
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { GraphAccessError, GraphStore } from './graph-store.ts';
import { handleGraphlessMessage, handleMessage } from './server.ts';
import { DEFAULT_PROTOCOL, SUPPORTED_PROTOCOLS } from './stdio.ts';

export const HTTP_PROTOCOLS = SUPPORTED_PROTOCOLS.filter((v) => v >= '2025-03-26');
export const MAX_HTTP_BODY = 1024 * 1024;

const json = (res: ServerResponse, status: number, value: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
};
const error = (res: ServerResponse, status: number, message: string, code = -32600, id: unknown = null): void =>
  json(res, status, { jsonrpc: '2.0', id, error: { code, message } });

function authorized(header: string | undefined, token: string): boolean {
  const a = Buffer.from(header ?? '');
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  // destroyOnReturn:false lets us send 413 before closing an oversized upload.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > MAX_HTTP_BODY) throw new Error('request body exceeds 1 MiB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createAtlasHttpServer(store: GraphStore, token: string): Server {
  if (token.length < 32) throw new Error('HTTP needs a bearer token of at least 32 characters');
  const server = createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 30_000, headersTimeout: 10_000 }, (req, res) => {
    void respond(req, res).catch((err: unknown) => {
      if (!res.destroyed) error(res, 500, (err as Error).message, -32603);
    });
  });
  server.maxRequestsPerSocket = 1000;

  async function respond(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const address = server.address() as { port: number };
    const hosts = [`127.0.0.1:${address.port}`, `localhost:${address.port}`];
    if (!hosts.includes(req.headers.host ?? '') || (req.headers.origin !== undefined && !hosts.some((h) => req.headers.origin === `http://${h}`))) {
      error(res, 403, 'Host or Origin is not this local server');
      return;
    }
    if (!authorized(req.headers.authorization, token)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="clojure-atlas"');
      error(res, 401, 'a valid bearer token is required');
      return;
    }
    const url = new URL(req.url!, `http://${hosts[0]}`);
    if (url.pathname === '/status' && req.method === 'GET') {
      json(res, 200, { service: 'clojure-atlas', graphs: store.status() });
      return;
    }
    if (url.pathname !== '/mcp') { error(res, 404, 'not found'); return; }
    // No unsolicited SSE stream or protocol session state; both endpoints may return 405 per MCP.
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); error(res, 405, 'use POST'); return; }
    if (url.searchParams.getAll('repo').length > 1 || [...url.searchParams.keys()].some((k) => k !== 'repo')) {
      error(res, 400, 'only one repo query parameter is accepted'); return;
    }
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      error(res, 415, 'Content-Type must be application/json'); return;
    }
    const accepts = (req.headers.accept ?? '').split(',').map((s) => s.split(';')[0].trim());
    if (!accepts.includes('application/json') || !accepts.includes('text/event-stream')) {
      error(res, 406, 'Accept must include application/json and text/event-stream'); return;
    }
    const protocol = req.headers['mcp-protocol-version'] ?? '2025-03-26';
    if (typeof protocol !== 'string' || !HTTP_PROTOCOLS.includes(protocol)) {
      error(res, 400, `unsupported MCP protocol; supported: ${HTTP_PROTOCOLS.join(', ')}`); return;
    }
    if (Number(req.headers['content-length']) > MAX_HTTP_BODY) {
      res.setHeader('Connection', 'close'); error(res, 413, 'request body exceeds 1 MiB'); return;
    }
    let raw: string;
    try { raw = await body(req); } catch (err) {
      res.setHeader('Connection', 'close'); error(res, 413, (err as Error).message); return;
    }
    let msg: unknown;
    try { msg = JSON.parse(raw); } catch { error(res, 400, 'parse error', -32700); return; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) { error(res, 400, 'expected a single JSON-RPC message'); return; }
    const message = msg as Record<string, unknown>;
    const id = typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null;
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string'
      || (message.id !== undefined && id === null) || (message.params !== undefined
        && (!message.params || typeof message.params !== 'object' || Array.isArray(message.params)))) {
      error(res, 400, 'invalid JSON-RPC request', -32600, id); return;
    }
    // HTTP never negotiates the legacy 2024 HTTP+SSE protocol, even though stdio still supports it.
    if (message.method === 'initialize') {
      const params = (message.params ?? {}) as Record<string, unknown>;
      const requested = params.protocolVersion;
      message.params = { ...params, protocolVersion: typeof requested === 'string' && HTTP_PROTOCOLS.includes(requested) ? requested : DEFAULT_PROTOCOL };
    }
    try {
      const repo = url.searchParams.get('repo');
      store.select(repo);
      // Only tools/call reads a graph, so a session can initialize before the first build or during a failed rebuild.
      const snapshot = message.method === 'tools/call' ? store.get(repo) : undefined;
      const result = await (snapshot ? handleMessage(snapshot.graph, message, snapshot.options) : handleGraphlessMessage(message));
      if (result === null) { res.writeHead(202); res.end(); }
      else json(res, 200, result);
    } catch (err) {
      error(res, err instanceof GraphAccessError ? 403 : 503, (err as Error).message, -32603, id);
    }
  }
  return server;
}

export async function listenAtlasHttp(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return (server.address() as { port: number }).port;
}

export function shutdownOnSignal(server: Server): void {
  const stop = () => {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    const timer = setTimeout(() => server.closeAllConnections(), 5000);
    timer.unref();
    server.close(() => clearTimeout(timer));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
