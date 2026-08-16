/** HTTP transport abstraction: the plugin uses requestUrl (bypasses CORS); node smoke tests use fetch */

export interface HttpResponse {
  status: number;
  body: ArrayBuffer;
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
  return Buffer.from(r.body).toString('utf8');
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
