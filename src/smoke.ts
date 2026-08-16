/**
 * Node smoke test: verify ilink gateway reachability and protocol correctness.
 * Usage: node scripts/smoke.js [qrcode|status <qrkey>|poll <token>|send|sendfile]
 */
import { readFileSync } from 'fs';
import type { HttpResponse, HttpTransport } from './core/http';
import { lowerHeaders } from './core/http';
import { fetchBotQrCode, pollQrStatus } from './core/qrlogin';
import { IlinkClient, isVideoExt } from './core/ilink';
import type { OutboundAttachment } from './core/types';

const BASE = 'https://ilinkai.weixin.qq.com';
const CDN = 'https://novac2c.cdn.weixin.qq.com/c2c';

class FetchTransport implements HttpTransport {
  private async run(
    method: 'GET' | 'POST',
    url: string,
    headers: Record<string, string>,
    body: string | ArrayBuffer | undefined,
    timeoutMs: number,
  ): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { method, headers, body, signal: controller.signal });
      const buf = await resp.arrayBuffer();
      const hdrs: Record<string, string> = {};
      resp.headers.forEach((v, k) => {
        hdrs[k] = v;
      });
      return { status: resp.status, body: buf, headers: lowerHeaders(hdrs) };
    } finally {
      clearTimeout(timer);
    }
  }

  get(url: string, headers: Record<string, string>, timeoutMs: number): Promise<HttpResponse> {
    return this.run('GET', url, headers, undefined, timeoutMs);
  }

  post(url: string, headers: Record<string, string>, body: string | ArrayBuffer, timeoutMs: number): Promise<HttpResponse> {
    return this.run('POST', url, headers, body, timeoutMs);
  }
}

/** Infer attachment kind from the file extension */
function attachmentFromFile(path: string): OutboundAttachment {
  const name = path.split('/').pop() ?? path;
  const ext = (name.includes('.') ? name.split('.').pop() ?? '' : '').toLowerCase();
  const imageExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);
  const kind: OutboundAttachment['kind'] = imageExts.has(ext) ? 'image' : isVideoExt(ext) ? 'video' : 'file';
  return { kind, name, data: new Uint8Array(readFileSync(path)) };
}

async function main(): Promise<void> {
  const transport = new FetchTransport();
  const cmd = process.argv[2] ?? 'qrcode';

  if (cmd === 'qrcode') {
    const qr = await fetchBotQrCode(transport, BASE);
    console.log('qrcode key:', qr.qrcode);
    console.log('URL:', qr.qrcode_img_content);
    console.log('\nnext step: node scripts/smoke.js status', qr.qrcode);
    return;
  }

  if (cmd === 'status') {
    const qrKey = process.argv[3];
    if (!qrKey) throw new Error('usage: smoke.js status <qrkey>');
    const st = await pollQrStatus(transport, BASE, qrKey);
    console.log(JSON.stringify(st, null, 2));
    return;
  }

  if (cmd === 'poll') {
    const token = process.argv[3];
    if (!token) throw new Error('usage: smoke.js poll <token>');
    const client = new IlinkClient(transport, { baseUrl: BASE, cdnBase: CDN }, token);
    console.log('Starting long-poll (Ctrl+C to exit)…');
    let cursor = '';
    for (;;) {
      const res = await client.poll(cursor);
      if (res.sessionExpired) {
        console.log('Session expired; re-scan required');
        return;
      }
      if (res.error) {
        console.error('error:', res.error);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (res.cursor) cursor = res.cursor;
      for (const m of res.messages) {
        console.log(`[${new Date(m.timeMs).toISOString()}] ${m.from}: ${m.text || `(${m.attachments.length} attachment(s))`}`);
      }
    }
  }

  if (cmd === 'send') {
    const token = process.argv[3];
    const to = process.argv[4];
    const text = process.argv.slice(5).join(' ');
    const contextToken = process.env.VXBOT_CONTEXT_TOKEN ?? '';
    if (!token || !to || !text) throw new Error('usage: smoke.js send <token> <to> <text>');
    const client = new IlinkClient(transport, { baseUrl: BASE, cdnBase: CDN }, token);
    const res = await client.sendText(to, text, contextToken);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === 'sendfile') {
    const token = process.argv[3];
    const to = process.argv[4];
    const filePath = process.argv[5];
    const contextToken = process.env.VXBOT_CONTEXT_TOKEN ?? '';
    if (!token || !to || !filePath) throw new Error('usage: smoke.js sendfile <token> <to> <file> (env VXBOT_CONTEXT_TOKEN)');
    const att = attachmentFromFile(filePath);
    console.log(`uploading ${att.kind} "${att.name}" (${att.data.length} bytes)…`);
    const client = new IlinkClient(transport, { baseUrl: BASE, cdnBase: CDN }, token);
    const res = await client.sendMedia(to, att, contextToken);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  console.error('unknown cmd:', cmd);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
