/** HTTP transport abstraction: the plugin runs on Node's http stack (NodeTransport); node smoke tests use fetch */

export interface HttpResponse {
  status: number;
  /** Widened from ArrayBuffer so transports can return a buffer view directly
   *  (NodeTransport avoids the concat->slice copy); plain ArrayBuffer works too. */
  body: ArrayBuffer | Uint8Array<ArrayBufferLike>;
  /** Response headers with lowercase keys */
  headers: Record<string, string>;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public status = 0,
    public timeout = false,
    public bodyPreview = '',
  ) {
    super(message);
  }
}

export interface HttpTransport {
  get(url: string, headers: Record<string, string>, timeoutMs: number): Promise<HttpResponse>;
  /** body accepts a JSON string or a binary buffer (CDN upload) */
  post(url: string, headers: Record<string, string>, body: string | ArrayBuffer, timeoutMs: number): Promise<HttpResponse>;
}

export function bodyText(r: HttpResponse): string {
  // wrap in a view first: Buffer.from has no (ArrayBuffer | Uint8Array) overload
  return Buffer.from(new Uint8Array(r.body)).toString('utf8');
}

/**
 * Decode a response body to text, transparently gunzipping when the transport
 * handed us a compressed body (some hosts ignore Accept-Encoding: identity).
 */
export async function bodyTextAuto(r: HttpResponse): Promise<string> {
  const bytes = new Uint8Array(r.body);
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return await new Response(stream).text();
    } catch {
      /* fall through to raw decode */
    }
  }
  return Buffer.from(new Uint8Array(r.body)).toString('utf8');
}

export function bodyJson<T>(r: HttpResponse): T {
  return JSON.parse(bodyText(r)) as T;
}

/** Normalize a header map to lowercase keys */
export function lowerHeaders(headers: Record<string, string> | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers) {
    for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  }
  return out;
}
