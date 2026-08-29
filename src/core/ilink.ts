/**
 * ilink gateway client: long-polling for messages, sending messages, media download.
 * Stateless dependencies: cursor/token are read and written by an external store,
 * making it easy to move the runtime environment later.
 */
import type { HttpTransport } from './http';
import { bodyJson, bodyText, HttpError } from './http';
import { downloadUrl, parseAesKey, decryptEcbInto, encryptEcbInto, md5Hex, ecbPaddedSize } from './crypto';
import { isSilk, silkToWav } from './silk';
import {
  type AttachmentFailure,
  type GetUpdatesResult,
  type GetUploadUrlResult,
  type InboundAttachment,
  type InboundMessage,
  type IlinkMedia,
  type IlinkMessage,
  type IlinkMsgItem,
  type OutboundAttachment,
  ERRCODE_SESSION_EXPIRED,
  ITEM_FILE,
  ITEM_IMAGE,
  ITEM_TEXT,
  ITEM_VIDEO,
  ITEM_VOICE,
  MSG_STATE_FINISH,
  MSG_TYPE_BOT,
  MSG_TYPE_USER,
  UPLOAD_MEDIA_FILE,
  UPLOAD_MEDIA_IMAGE,
  UPLOAD_MEDIA_VIDEO,
} from './types';

export interface IlinkClientOptions {
  baseUrl: string;
  cdnBase: string;
  channelVersion?: string;
  longPollTimeoutMs?: number;
}

export interface SendResult {
  ok: boolean;
  ret: number;
  errcode: number;
  errmsg: string;
  /** Raw gateway response (truncated); used for diagnostics when success fields are missing */
  raw?: string;
}

export interface PollResult {
  messages: InboundMessage[];
  /** Cursor to carry on the next long-poll; empty means keep the previous one */
  cursor?: string;
  sessionExpired: boolean;
  error?: string;
}

export class IlinkClient {
  constructor(
    private transport: HttpTransport,
    private opts: IlinkClientOptions,
    private token: string,
  ) {}

  private get channelVersion(): string {
    return this.opts.channelVersion ?? 'wechatian-weixin/1.0';
  }

  private get longPollTimeoutMs(): number {
    return this.opts.longPollTimeoutMs ?? 35_000;
  }

  private randomUin(): string {
    const n = Math.floor(Math.random() * 0xffffffff) >>> 0;
    return Buffer.from(String(n)).toString('base64');
  }

  private post<T>(path: string, body: object, timeoutMs: number): Promise<T> {
    const url = `${this.opts.baseUrl.replace(/\/$/, '')}/${path}`;
    return this.transport
      .post(url, this.authHeaders(), JSON.stringify(body), timeoutMs)
      .then((r) => {
        if (r.status !== 200) {
          throw new HttpError(`${path} http ${r.status}`, r.status);
        }
        return bodyJson<T>(r);
      });
  }

  /**
   * One long-poll round. Network timeouts are not treated as errors
   * (normal for long polling) and return an empty result.
   */
  async poll(cursor: string): Promise<PollResult> {
    try {
      const resp = await this.post<GetUpdatesResult>(
        'ilink/bot/getupdates',
        { get_updates_buf: cursor, base_info: { channel_version: this.channelVersion } },
        this.longPollTimeoutMs + 10_000,
      );

      if (resp.errcode === ERRCODE_SESSION_EXPIRED) {
        return { messages: [], sessionExpired: true };
      }
      const messages: InboundMessage[] = [];
      for (const m of resp.msgs ?? []) {
        const msg = await this.toInbound(m);
        if (msg) messages.push(msg);
      }
      return {
        messages,
        cursor: resp.get_updates_buf || undefined,
        sessionExpired: false,
      };
    } catch (e) {
      if (e instanceof HttpError && e.timeout) {
        return { messages: [], sessionExpired: false };
      }
      // 401/403/412 mean the gateway rejects this session outright (stale or
      // superseded cursor/token). Retrying the same one forever changes
      // nothing — surface it as session expiry so the user re-scans instead.
      if (e instanceof HttpError && (e.status === 412 || e.status === 401 || e.status === 403)) {
        return { messages: [], sessionExpired: true };
      }
      return { messages: [], sessionExpired: false, error: String((e as Error)?.message ?? e) };
    }
  }

  /** Filter/parse a raw message into the inbound structure (including media download + decryption) */
  private async toInbound(m: IlinkMessage): Promise<InboundMessage | null> {
    if (m.message_type === MSG_TYPE_BOT) return null;
    if (m.message_type !== 0 && m.message_type !== MSG_TYPE_USER) return null;
    const from = (m.from_user_id ?? '').trim();
    if (!from) return null;

    const items = m.item_list ?? [];
    const text = extractText(items);
    // attachment names are numbered per message, so parallel downloads of
    // different messages never collide
    const { attachments, failures: attachmentFailures } = await this.collectMedia(items, `msg_${m.message_id ?? m.create_time_ms ?? 0}`);
    if (!text.trim() && attachments.length === 0 && attachmentFailures.length === 0) return null;

    return {
      from,
      messageId: m.message_id ? String(m.message_id) : `${m.create_time_ms ?? Date.now()}`,
      timeMs: m.create_time_ms ?? Date.now(),
      text,
      attachments,
      attachmentFailures,
      raw: m,
    };
  }

  /** Download and decrypt media in the message; failures are recorded with a reason, text still comes through */
  private async collectMedia(items: IlinkMsgItem[], prefix: string): Promise<{ attachments: InboundAttachment[]; failures: AttachmentFailure[] }> {
    const attachments: InboundAttachment[] = [];
    const failures: AttachmentFailure[] = [];
    const cdnBase = this.opts.cdnBase.replace(/\/$/, '');
    if (!cdnBase) return { attachments, failures };
    const tasks: Promise<void>[] = [];

    const grab = (
      media: IlinkMedia | undefined,
      aesKeyB64: string | undefined,
      kind: InboundAttachment['kind'],
      name: string,
      mime: string,
    ) => {
      const enc = (media?.encrypt_query_param ?? '').trim();
      if (!enc) return;
      const key = aesKeyB64 ? parseAesKey(aesKeyB64) : null;
      const url = downloadUrl(cdnBase, enc);
      tasks.push(
        this.transport
          .get(url, {}, 60_000)
          .then(async (r) => {
            if (r.status !== 200) {
              failures.push({ kind, name, reason: `http ${r.status}` });
              return;
            }
            if (r.body.byteLength > MAX_DOWNLOAD_BYTES) {
              failures.push({ kind, name, reason: `too large (${(r.body.byteLength / 1048576).toFixed(1)}MB, limit 100MB)` });
              return;
            }
            // body is either a raw ArrayBuffer or a transport-owned Uint8Array
            // view; wrap it without copying either way. Decryption writes into a
            // fresh buffer, so the attachment never shares backing memory with
            // the transport's read buffer.
            let buf: Buffer =
              r.body instanceof Uint8Array
                ? Buffer.from(r.body.buffer, r.body.byteOffset, r.body.byteLength)
                : Buffer.from(r.body);
            if (key) {
              const out = Buffer.allocUnsafe(buf.length);
              const n = decryptEcbInto(buf, key, out);
              buf = out.subarray(0, n);
            }
            // Voice arrives as WeChat SILK, which no player renders. Transcode
            // to WAV in-plugin so the note embed is playable. On any failure we
            // fall back to the raw .silk so the audio is never lost.
            if (kind === 'audio' && isSilk(buf)) {
              const wav = await silkToWav(buf).catch(() => null);
              if (wav) {
                attachments.push({ kind, name: name.replace(/\.silk$/i, '.wav'), mime: 'audio/wav', data: wav });
                return;
              }
            }
            attachments.push({ kind, name, mime, data: new Uint8Array(buf) });
          })
          .catch((e: unknown) => {
            failures.push({ kind, name, reason: String((e as Error)?.message ?? e) });
          }),
      );
    };

    for (const it of items) {
      switch (it.type) {
        case ITEM_IMAGE: {
          const img = it.image_item;
          if (!img?.media) break;
          let keyB64 = img.media.aes_key;
          if (img.aeskey) {
            const raw = Buffer.from(img.aeskey, 'hex');
            if (raw.length === 16) keyB64 = raw.toString('base64');
          }
          grab(img.media, keyB64, 'image', `image_${prefix}_${attachments.length}.bin`, 'image/*');
          break;
        }
        case ITEM_FILE: {
          const f = it.file_item;
          if (!f?.media) break;
          grab(f.media, f.media.aes_key, 'file', f.file_name || 'attachment.bin', 'application/octet-stream');
          break;
        }
        case ITEM_VIDEO: {
          const v = it.video_item;
          if (!v?.media) break;
          grab(v.media, v.media.aes_key, 'video', `video_${prefix}_${attachments.length}.mp4`, 'video/mp4');
          break;
        }
        case ITEM_VOICE: {
          const v = it.voice_item;
          if (!v?.media) break;
          // keep the audio even when the gateway ships an ASR transcript:
          // the transcript becomes the note text, the transcoded wav stays
          // playable — one no longer substitutes for the other
          grab(v.media, v.media.aes_key, 'audio', `voice_${prefix}_${attachments.length}.silk`, 'audio/silk');
          break;
        }
      }
    }
    await Promise.all(tasks);
    return { attachments, failures };
  }

  /** Send text (auto-chunked at 3800 characters, 100ms between chunks) */
  async sendText(to: string, text: string, contextToken: string, chunkSize = 3800): Promise<SendResult> {
    if (!contextToken.trim()) {
      return { ok: false, ret: 0, errcode: 0, errmsg: 'missing context_token: the user must message the bot first' };
    }
    const chunks = splitByCodePoints(text, chunkSize);
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await sleep(100);
      const res = await this.sendOneText(to, chunks[i], contextToken);
      if (!res.ok) return res;
    }
    return { ok: true, ret: 0, errcode: 0, errmsg: '' };
  }

  private async sendOneText(to: string, text: string, contextToken: string): Promise<SendResult> {
    const clientId = `wct-${randomHex(6)}`;
    const body = {
      msg: {
        from_user_id: '',
        to_user_id: to,
        client_id: clientId,
        message_type: MSG_TYPE_BOT,
        message_state: MSG_STATE_FINISH,
        item_list: [{ type: ITEM_TEXT, text_item: { text } }],
        context_token: contextToken,
      },
      base_info: { channel_version: this.channelVersion },
    };
    try {
      const resp = await this.transport.post(`${this.opts.baseUrl.replace(/\/$/, '')}/ilink/bot/sendmessage`, this.authHeaders(), JSON.stringify(body), 15_000);
      const text0 = bodyText(resp);
      let parsed: { ret?: number; errcode?: number; errmsg?: string } = {};
      try {
        parsed = JSON.parse(text0) as { ret?: number; errcode?: number; errmsg?: string };
      } catch {
        /* non-JSON ack: keep defaults */
      }
      // Accept whichever success indicator the gateway returns; some deployments
      // reply with just {} or {"errmsg": ""} when the message goes through
      let ok = false;
      if (typeof parsed.ret === 'number') ok = parsed.ret === 0;
      else if (typeof parsed.errcode === 'number') ok = parsed.errcode === 0;
      else ok = resp.status === 200 && !parsed.errmsg;
      return { ok, ret: parsed.ret ?? 0, errcode: parsed.errcode ?? 0, errmsg: parsed.errmsg ?? '', raw: text0.slice(0, 300) };
    } catch (e) {
      return { ok: false, ret: -1, errcode: 0, errmsg: String((e as Error)?.message ?? e) };
    }
  }

  /** Fetch per-user bot config; typing_ticket is the credential sendtyping needs (TTL handled by the caller) */
  async getConfig(ilinkUserId: string, contextToken: string): Promise<{ typingTicket: string }> {
    try {
      const resp = await this.post<{ typing_ticket?: string }>(
        'ilink/bot/getconfig',
        { ilink_user_id: ilinkUserId, context_token: contextToken, base_info: { channel_version: this.channelVersion } },
        10_000,
      );
      return { typingTicket: (resp.typing_ticket ?? '').trim() };
    } catch {
      return { typingTicket: '' };
    }
  }

  /** Show/cancel the "typing" indicator in the user's chat. Best-effort: returns false on any failure */
  async sendTyping(ilinkUserId: string, typingTicket: string, active: boolean): Promise<boolean> {
    if (!typingTicket.trim()) return false;
    try {
      await this.post<Record<string, unknown>>(
        'ilink/bot/sendtyping',
        {
          ilink_user_id: ilinkUserId,
          typing_ticket: typingTicket,
          status: active ? 1 : 2, // 1 = typing, 2 = cancel
          base_info: { channel_version: this.channelVersion },
        },
        10_000,
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Send one media/file attachment: AES-ECB encrypt -> getuploadurl -> CDN upload -> sendmessage */
  async sendMedia(to: string, att: OutboundAttachment, contextToken: string): Promise<SendResult> {
    try {
      if (!contextToken.trim()) {
        throw new Error('missing context_token: the user must message the bot first');
      }
      if (!att.data.length) throw new Error('empty attachment');
      if (att.data.length > MAX_UPLOAD_BYTES) {
        throw new Error(`attachment too large: ${(att.data.length / 1048576).toFixed(1)}MB (limit 100MB)`);
      }

      const ref = await this.uploadToCdn(to, att);
      const item = buildMediaItem(att, ref);
      const body = {
        msg: {
          from_user_id: '',
          to_user_id: to,
          client_id: `wct-${randomHex(6)}`,
          message_type: MSG_TYPE_BOT,
          message_state: MSG_STATE_FINISH,
          item_list: [item],
          context_token: contextToken,
        },
        base_info: { channel_version: this.channelVersion },
      };
      const resp = await this.transport.post(
        `${this.opts.baseUrl.replace(/\/$/, '')}/ilink/bot/sendmessage`,
        this.authHeaders(),
        JSON.stringify(body),
        15_000,
      );
      const text0 = bodyText(resp);
      let parsed: { ret?: number; errcode?: number; errmsg?: string } = {};
      try {
        parsed = JSON.parse(text0) as { ret?: number; errcode?: number; errmsg?: string };
      } catch {
        /* non-JSON ack: keep defaults */
      }
      let ok = false;
      if (typeof parsed.ret === 'number') ok = parsed.ret === 0;
      else if (typeof parsed.errcode === 'number') ok = parsed.errcode === 0;
      else ok = resp.status === 200 && !parsed.errmsg;
      return { ok, ret: parsed.ret ?? 0, errcode: parsed.errcode ?? 0, errmsg: parsed.errmsg ?? '', raw: text0.slice(0, 300) };
    } catch (e) {
      return { ok: false, ret: -1, errcode: 0, errmsg: String((e as Error)?.message ?? e) };
    }
  }

  /** Encrypt + CDN upload; returns the CDN reference used in sendmessage */
  private async uploadToCdn(to: string, att: OutboundAttachment): Promise<CdnUploadedRef> {
    const cdnBase = this.opts.cdnBase.replace(/\/$/, '');
    if (!cdnBase) throw new Error('cdn_base is empty');

    const key = randomBytes16();
    const filekey = randomHex(16);
    const mediaType = att.kind === 'image' ? UPLOAD_MEDIA_IMAGE : att.kind === 'video' ? UPLOAD_MEDIA_VIDEO : UPLOAD_MEDIA_FILE;
    // Encrypt into one precisely-sized buffer (md5 reads the view directly,
    // so there is no extra plaintext copy). allocUnsafeSlow never uses the
    // small-buffer pool, so cipher.buffer IS exactly the ciphertext for any
    // size and uploadCipher can hand it to the transport without allocating
    // a second full-size buffer — the transport's own write copy aside, the
    // peak for a 100MB upload stays at ~200MB instead of ~300MB.
    const plain = Buffer.from(att.data.buffer, att.data.byteOffset, att.data.byteLength);
    const cipher = Buffer.allocUnsafeSlow(ecbPaddedSize(plain.length));
    encryptEcbInto(plain, key, cipher);

    const up = await this.post<GetUploadUrlResult>(
      'ilink/bot/getuploadurl',
      {
        filekey,
        media_type: mediaType,
        to_user_id: to,
        rawsize: plain.length,
        rawfilemd5: md5Hex(att.data),
        filesize: ecbPaddedSize(plain.length),
        no_need_thumb: true,
        aeskey: key.toString('hex'), // note: hex string here, NOT the base64(hex) used in sendmessage
        base_info: { channel_version: this.channelVersion },
      },
      15_000,
    );
    if ((up.errcode ?? 0) !== 0) throw new Error(`getuploadurl errcode=${up.errcode} ${up.errmsg ?? ''}`);

    // Newer gateways return the full CDN URL; older ones return upload_param
    const uploadUrl = (up.upload_full_url ?? '').trim()
      || buildCdnUploadUrl(cdnBase, (up.upload_param ?? '').trim(), filekey);
    if (!uploadUrl) throw new Error(`getuploadurl returned neither upload_param nor upload_full_url`);

    const downloadParam = await this.uploadCipher(uploadUrl, cipher);
    return { downloadParam, aesKey: key, cipherSize: cipher.length, rawSize: plain.length };
  }

  /** POST ciphertext to the CDN; the x-encrypted-param response header is the download credential */
  private async uploadCipher(url: string, cipher: Buffer): Promise<string> {
    let lastErr = '';
    // cipher is allocated with exactly the cipher size (allocUnsafeSlow: never
    // pooled), so its backing buffer is precisely the upload body — no slice/copy
    const body = cipher.buffer as ArrayBuffer;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await this.transport.post(url, { 'Content-Type': 'application/octet-stream' }, body, 120_000);
        if (r.status >= 400 && r.status < 500) {
          const msg = r.headers['x-error-message'] || `http ${r.status}`;
          // HttpError so the catch below fails fast on client errors (retrying is pointless)
          throw new HttpError(`CDN upload client error: ${msg}`, r.status);
        }
        if (r.status !== 200) {
          lastErr = r.headers['x-error-message'] || `http ${r.status}`;
          continue; // 5xx: retry
        }
        const dl = (r.headers['x-encrypted-param'] ?? '').trim();
        if (dl) return dl;
        lastErr = 'CDN response missing x-encrypted-param header';
      } catch (e) {
        if (attempt === 3 || (e instanceof HttpError && e.status >= 400 && e.status < 500)) throw e;
        lastErr = String((e as Error)?.message ?? e);
      }
    }
    throw new Error(`CDN upload failed after 3 attempts: ${lastErr}`);
  }

  /** Headers shared by getupdates/sendmessage */
  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      AuthorizationType: 'ilink_bot_token',
      'X-WECHAT-UIN': this.randomUin(),
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }
}

/** Extract the visible text of a message: body, quotes, voice transcription */
export function extractText(items: IlinkMsgItem[]): string {
  if (!items.length) return '';
  for (const item of items) {
    switch (item.type) {
      case ITEM_TEXT: {
        const text = (item.text_item?.text ?? '').trim();
        const ref = item.ref_msg;
        if (!ref) return text;
        const isMediaRef = ref.message_item && [ITEM_IMAGE, ITEM_VOICE, ITEM_FILE, ITEM_VIDEO].includes(ref.message_item.type ?? 0);
        if (isMediaRef) return text;
        const parts: string[] = [];
        if (ref.title) parts.push(ref.title);
        if (ref.message_item) {
          const refBody = extractText([ref.message_item]);
          if (refBody) parts.push(refBody);
        }
        if (!parts.length) return text;
        return `[Quote: ${parts.join(' | ')}]\n${text}`;
      }
      case ITEM_VOICE: {
        const t = (item.voice_item?.text ?? '').trim();
        if (t) return t;
        break;
      }
    }
  }
  return '';
}

/** Split by Unicode code points to avoid truncating emoji/CJK characters */
export function splitByCodePoints(s: string, max: number): string[] {
  const cps = Array.from(s);
  if (cps.length <= max) return [s];
  const out: string[] = [];
  for (let i = 0; i < cps.length; i += max) out.push(cps.slice(i, i + max).join(''));
  return out;
}

export function randomHex(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

/** 100MB CDN limit, aligned with cc-connect */
export const MAX_UPLOAD_BYTES = 100 << 20;

/** Cap on one inbound media download: a malformed/hostile gateway message must not exhaust memory */
export const MAX_DOWNLOAD_BYTES = MAX_UPLOAD_BYTES;

export interface CdnUploadedRef {
  downloadParam: string;
  aesKey: Buffer;
  cipherSize: number;
  rawSize: number;
}

export function randomBytes16(): Buffer {
  const b = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

export function buildCdnUploadUrl(cdnBase: string, uploadParam: string, filekey: string): string {
  return `${cdnBase.replace(/\/$/, '')}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;
}

/** media.aes_key in sendmessage is base64(hex) — different from the hex string sent to getuploadurl */
function aesKeyForApi(key: Buffer): string {
  return Buffer.from(key.toString('hex')).toString('base64');
}

const VIDEO_EXTS = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'webm']);
export function isVideoExt(ext: string): boolean {
  return VIDEO_EXTS.has(ext.toLowerCase());
}

/** Build the sendmessage item_list entry for an uploaded attachment */
export function buildMediaItem(att: OutboundAttachment, ref: CdnUploadedRef): IlinkMsgItem {
  const media: IlinkMedia = {
    encrypt_query_param: ref.downloadParam,
    aes_key: aesKeyForApi(ref.aesKey),
    encrypt_type: 1,
  };
  switch (att.kind) {
    case 'image':
      return { type: ITEM_IMAGE, image_item: { media, mid_size: ref.cipherSize } };
    case 'video':
      return { type: ITEM_VIDEO, video_item: { media, video_size: ref.cipherSize } };
    default:
      return { type: ITEM_FILE, file_item: { media, file_name: att.name, len: String(ref.rawSize) } };
  }
}
