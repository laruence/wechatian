/** HTTP transport for the Obsidian environment: uses requestUrl to bypass CORS, maps errors to HttpError */
import { requestUrl } from 'obsidian';
import type { HttpTransport, HttpResponse } from './http';
import { HttpError, lowerHeaders } from './http';

export class ObsidianTransport implements HttpTransport {
  async get(url: string, headers: Record<string, string>, timeoutMs: number): Promise<HttpResponse> {
    return this.run('GET', url, headers, undefined, timeoutMs);
  }

  async post(url: string, headers: Record<string, string>, body: string | ArrayBuffer, timeoutMs: number): Promise<HttpResponse> {
    return this.run('POST', url, headers, body, timeoutMs);
  }

  private async run(
    method: 'GET' | 'POST',
    url: string,
    headers: Record<string, string>,
    body: string | ArrayBuffer | undefined,
    timeoutMs: number,
  ): Promise<HttpResponse> {
    // requestUrl has no official timeout parameter; race a timer and treat it as a timeout when it fires
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HttpError('request timeout', 0, true)), timeoutMs);
    });
    try {
      const resp = await Promise.race([
        requestUrl({ url, method, headers, body, throw: false }),
        timeoutPromise,
      ]);
      return { status: resp.status, body: resp.arrayBuffer, headers: lowerHeaders(resp.headers) };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const msg = String((e as Error)?.message ?? e);
      throw new HttpError(msg, 0, /abort|timeout|timed out/i.test(msg));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
