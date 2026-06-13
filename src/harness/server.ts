/**
 * Lightweight local review UI + JSON API for the human review gate.
 *
 * Built on node:http (no express, no build step). It serves:
 *   - a self-contained HTML page listing pending clips with video previews,
 *   - a small JSON API the page calls to approve/reject,
 *   - the rendered clip files themselves for in-browser preview.
 *
 * This is intended to run on the local network only (the operator's machine).
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { extname } from 'node:path';
import type { ClipStatus } from '../core/types.js';
import { createLogger } from '../core/logger.js';
import type { Logger } from '../core/logger.js';
import type { ReviewStore } from './reviewStore.js';

export interface ReviewServerOptions {
  logger?: Logger;
}

const VIDEO_CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};

/** Build the review HTTP server. Call `.listen()` (or the returned `start`). */
export function createReviewServer(store: ReviewStore, opts: ReviewServerOptions = {}): Server {
  const log = opts.logger ?? createLogger('harness');

  const server = createServer((req, res) => {
    handle(req, res, store).catch((err: unknown) => {
      log.error({ err }, 'review server request failed');
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
      else res.end();
    });
  });

  return server;
}

/**
 * Listen on `port` and log the URL. Returns the listening server.
 * Pass `port: 0` for an ephemeral port (used by tests).
 */
export function start(
  store: ReviewStore,
  port: number,
  opts: ReviewServerOptions = {},
): Promise<Server> {
  const log = opts.logger ?? createLogger('harness');
  const server = createReviewServer(store, { ...opts, logger: log });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      log.info({ url: `http://localhost:${actualPort}/` }, 'review server listening');
      resolve(server);
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  store: ReviewStore,
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (method === 'GET' && path === '/') {
    sendHtml(res, 200, renderPage());
    return;
  }

  if (method === 'GET' && path === '/api/clips') {
    const statusParam = url.searchParams.get('status') ?? undefined;
    const clips = await store.list(statusParam as ClipStatus | undefined);
    sendJson(res, 200, clips);
    return;
  }

  const approveMatch = /^\/api\/clips\/([^/]+)\/approve$/.exec(path);
  if (method === 'POST' && approveMatch?.[1]) {
    await withRecord(res, store.approve(decodeURIComponent(approveMatch[1])));
    return;
  }

  const rejectMatch = /^\/api\/clips\/([^/]+)\/reject$/.exec(path);
  if (method === 'POST' && rejectMatch?.[1]) {
    const body = await readJsonBody(req);
    const reason = typeof body?.['reason'] === 'string' ? (body['reason'] as string) : undefined;
    await withRecord(res, store.reject(decodeURIComponent(rejectMatch[1]), reason));
    return;
  }

  const videoMatch = /^\/clip\/([^/]+)\/video$/.exec(path);
  if (method === 'GET' && videoMatch?.[1]) {
    await serveVideo(res, store, decodeURIComponent(videoMatch[1]));
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
}

async function withRecord(res: ServerResponse, op: Promise<unknown>): Promise<void> {
  try {
    const clip = await op;
    sendJson(res, 200, clip);
  } catch (err) {
    sendJson(res, 404, { error: 'not_found', message: (err as Error).message });
  }
}

async function serveVideo(res: ServerResponse, store: ReviewStore, id: string): Promise<void> {
  const clip = await store.get(id);
  if (!clip) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  const filePath = clip.renderedPath;
  // Only ever serve the exact stored path — no client-supplied path joins.
  if (!filePath) {
    sendJson(res, 404, { error: 'no_rendered_file' });
    return;
  }
  let size: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      sendJson(res, 404, { error: 'not_a_file' });
      return;
    }
    size = info.size;
  } catch {
    sendJson(res, 404, { error: 'file_missing' });
    return;
  }
  const contentType =
    VIDEO_CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': contentType, 'content-length': size });
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) sendJson(res, 500, { error: 'stream_error' });
    else res.destroy();
  });
  stream.pipe(res);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

/** Self-contained review page. No external assets, no build step. */
function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Clip Review</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 1.5rem; }
  h1 { font-size: 1.25rem; }
  #clips { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  .card { border: 1px solid #8884; border-radius: 10px; padding: 0.75rem; }
  .card video { width: 100%; border-radius: 6px; background: #000; }
  .caption { font-weight: 600; margin: 0.5rem 0; }
  .meta { font-size: 0.8rem; opacity: 0.7; }
  .actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  button { flex: 1; padding: 0.5rem; border-radius: 6px; border: 0; cursor: pointer; font-weight: 600; }
  .approve { background: #1f9d55; color: #fff; }
  .reject { background: #d64545; color: #fff; }
  .empty { opacity: 0.7; }
</style>
</head>
<body>
<h1>Clips awaiting review</h1>
<div id="clips"><p class="empty">Loading…</p></div>
<script>
const root = document.getElementById('clips');
async function load() {
  const res = await fetch('/api/clips?status=rendered');
  const clips = await res.json();
  if (!clips.length) { root.innerHTML = '<p class="empty">Nothing pending. </p>'; return; }
  root.innerHTML = '';
  for (const clip of clips) {
    const card = document.createElement('div');
    card.className = 'card';
    const dur = (clip.endSec - clip.startSec).toFixed(1);
    card.innerHTML =
      '<video controls preload="metadata" src="/clip/' + encodeURIComponent(clip.id) + '/video"></video>' +
      '<p class="caption"></p>' +
      '<p class="meta"></p>' +
      '<div class="actions">' +
        '<button class="approve">Approve</button>' +
        '<button class="reject">Reject</button>' +
      '</div>';
    card.querySelector('.caption').textContent = (clip.caption && clip.caption.text) || '(no caption)';
    card.querySelector('.meta').textContent = clip.id + ' · ' + dur + 's';
    card.querySelector('.approve').onclick = () => decide(clip.id, 'approve');
    card.querySelector('.reject').onclick = () => {
      const reason = prompt('Reason for rejecting? (optional)') || undefined;
      decide(clip.id, 'reject', reason);
    };
    root.appendChild(card);
  }
}
async function decide(id, action, reason) {
  await fetch('/api/clips/' + encodeURIComponent(id) + '/' + action, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(reason ? { reason } : {}),
  });
  load();
}
load();
</script>
</body>
</html>`;
}
