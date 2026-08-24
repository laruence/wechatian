/**
 * HTTP transport on Node's http/https: bypasses Obsidian's requestUrl IPC channel,
 * which has no timeout/cancel and can wedge the app when a host misbehaves (see
 * issue #1: mp.weixin.qq.com slow-drip). Here the timeout is an *idle* timeout:
 * as long as data keeps flowing the request runs to completion (slow is fine),
 * and only a connection that goes silent for the full window is killed.
 * Redirects are followed manually.
 */
import * as http from 'http';
import * as https from 'https';
import type { HttpTransport, HttpResponse } from './http';
import { HttpError } from './http';

const MAX_REDIRECTS = 5;

export class NodeTransport implements HttpTransport {
  async get(url: string, headers: Record<string, string>, timeoutMs: number): Promise<HttpResponse> {
    return this.request('GET', url, headers, undefined, timeoutMs, 0);
  }

  async post(url: string, headers: Record<string, string>, body: string | ArrayBuffer, timeoutMs: number): Promise<HttpResponse> {
    return this.request('POST', url, headers, body, timeoutMs, 0);
  }

  private request(
    method: 'GET' | 'POST',
    url: string,
    headers: Record<string, string>,
    body: string | ArrayBuffer | undefined,
    timeoutMs: number,
    redirects: number,
  ): Promise<HttpResponse> {
    return new Promise<HttpResponse>((resolve, reject) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        reject(new HttpError(`invalid url: ${url}`));
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        reject(new HttpError(`unsupported protocol: ${parsed.protocol}`));
        return;
      }
      const mod = parsed.protocol === 'http:' ? http : https;

      // idle timeout: killed only when the connection goes silent; slow-but-flowing
      // downloads (WeChat WAF slow-drip) run to completion
      let settled = false;
      let deadline: number | undefined;
      const arm = (): void => {
        if (deadline) window.clearTimeout(deadline);
        deadline = window.setTimeout(() => {
          req.destroy(new HttpError('request timeout', 0, true));
        }, timeoutMs);
      };
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        if (deadline) window.clearTimeout(deadline);
        fn();
      };
      arm();

      const req = mod.request(
        parsed,
        { method, headers, timeout: timeoutMs },
        (res) => {
          const status = res.statusCode ?? 0;
          // follow redirects manually; 303 (and 301/302 for POST) become GET
          if ([301, 302, 303, 307, 308].includes(status) && redirects < MAX_REDIRECTS) {
            const loc = res.headers.location;
            res.resume(); // drain the redirect body
            if (loc) {
              settled = true;
              window.clearTimeout(deadline);
              const nextMethod = method === 'POST' && status !== 307 && status !== 308 ? 'GET' : method;
              const nextBody = nextMethod === 'GET' ? undefined : body;
              this.request(nextMethod, new URL(loc, parsed).toString(), headers, nextBody, timeoutMs, redirects + 1).then(
                resolve,
                reject,
              );
              return;
            }
          }

          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => {
            arm(); // data flowing: the connection is alive, keep waiting
            chunks.push(c);
          });
          res.on('error', (e) => settle(() => reject(new HttpError(String((e)?.message ?? e), status))));
          res.on('end', () => {
            settle(() => {
              const buf = Buffer.concat(chunks);
              const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
              resolve({ status, body: ab, headers: flatHeaders(res.headers) });
            });
          });
        },
      );

      req.on('timeout', () => req.destroy(new HttpError('request timeout', 0, true)));
      req.on('error', (e) => {
        settle(() => {
          if (e instanceof HttpError) reject(e);
          const msg = String((e)?.message ?? e);
          reject(new HttpError(msg, 0, /timeout|timed out|ECONNRESET|ETIMEDOUT|ECONNREFUSED|abort/i.test(msg)));
        });
      });

      if (body !== undefined) req.write(Buffer.from(body instanceof ArrayBuffer ? new Uint8Array(body) : body));
      req.end();
    });
  }
}

/** IncomingHttpHeaders allows string[] and undefined; flatten to lowercase string map */
function flatHeaders(h: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}
