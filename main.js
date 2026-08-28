"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => WechatianPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian6 = require("obsidian");

// src/core/http.ts
var HttpError = class extends Error {
  constructor(message, status = 0, timeout = false, bodyPreview = "") {
    super(message);
    this.status = status;
    this.timeout = timeout;
    this.bodyPreview = bodyPreview;
  }
};
function bodyText(r) {
  return Buffer.from(r.body).toString("utf8");
}
async function bodyTextAuto(r) {
  const bytes = new Uint8Array(r.body);
  if (bytes.length > 2 && bytes[0] === 31 && bytes[1] === 139) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return await new Response(stream).text();
    } catch {
    }
  }
  return Buffer.from(r.body).toString("utf8");
}
function bodyJson(r) {
  return JSON.parse(bodyText(r));
}
function lowerHeaders(headers) {
  const out = {};
  if (headers) {
    for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  }
  return out;
}

// src/core/crypto.ts
var import_crypto = require("crypto");
function parseAesKey(aesKeyBase64) {
  try {
    const dec = Buffer.from(aesKeyBase64.trim(), "base64");
    if (dec.length === 16) return dec;
    if (dec.length === 32) {
      const s = dec.toString("ascii");
      if (/^[0-9a-fA-F]{32}$/.test(s)) return Buffer.from(s, "hex");
    }
  } catch {
  }
  return null;
}
function decryptEcb(cipher, key) {
  const d = (0, import_crypto.createDecipheriv)("aes-128-ecb", key, null);
  d.setAutoPadding(true);
  return Buffer.concat([d.update(cipher), d.final()]);
}
function encryptEcbInto(plain, key, out) {
  const c = (0, import_crypto.createCipheriv)("aes-128-ecb", key, null);
  c.setAutoPadding(true);
  let off = 0;
  const CHUNK = 1 << 20;
  while (plain.length - off > CHUNK) {
    off += c.update(plain.subarray(off, off + CHUNK)).copy(out, off);
  }
  off += c.update(plain.subarray(off)).copy(out, off);
  c.final().copy(out, off);
}
function downloadUrl(cdnBase, encParam) {
  return `${cdnBase.replace(/\/$/, "")}/download?encrypted_query_param=${encodeURIComponent(encParam)}`;
}
function detectImageExt(b) {
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return "jpg";
  if (b.length >= 8 && Buffer.from(b.slice(0, 8)).toString("binary") === "\x89PNG\r\n\n") return "png";
  if (b.length >= 6 && ["GIF87a", "GIF89a"].includes(Buffer.from(b.slice(0, 6)).toString("ascii"))) return "gif";
  if (b.length >= 12 && Buffer.from(b.slice(0, 4)).toString("ascii") === "RIFF" && Buffer.from(b.slice(8, 12)).toString("ascii") === "WEBP") return "webp";
  return "jpg";
}
function md5Hex(b) {
  return (0, import_crypto.createHash)("md5").update(b).digest("hex");
}
function ecbPaddedSize(plainLen) {
  if (plainLen < 0) return 0;
  return Math.floor((plainLen + 16) / 16) * 16;
}

// src/core/types.ts
var MSG_TYPE_USER = 1;
var MSG_TYPE_BOT = 2;
var ITEM_TEXT = 1;
var ITEM_IMAGE = 2;
var ITEM_VOICE = 3;
var ITEM_FILE = 4;
var ITEM_VIDEO = 5;
var MSG_STATE_FINISH = 2;
var ERRCODE_SESSION_EXPIRED = -14;
var UPLOAD_MEDIA_IMAGE = 1;
var UPLOAD_MEDIA_VIDEO = 2;
var UPLOAD_MEDIA_FILE = 3;

// src/core/ilink.ts
var IlinkClient = class {
  constructor(transport, opts, token) {
    this.transport = transport;
    this.opts = opts;
    this.token = token;
  }
  get channelVersion() {
    return this.opts.channelVersion ?? "wechatian-weixin/1.0";
  }
  get longPollTimeoutMs() {
    return this.opts.longPollTimeoutMs ?? 35e3;
  }
  randomUin() {
    const n = Math.floor(Math.random() * 4294967295) >>> 0;
    return Buffer.from(String(n)).toString("base64");
  }
  post(path, body, timeoutMs) {
    const url = `${this.opts.baseUrl.replace(/\/$/, "")}/${path}`;
    return this.transport.post(url, this.authHeaders(), JSON.stringify(body), timeoutMs).then((r) => {
      if (r.status !== 200) {
        throw new HttpError(`${path} http ${r.status}`, r.status);
      }
      return bodyJson(r);
    });
  }
  /**
   * One long-poll round. Network timeouts are not treated as errors
   * (normal for long polling) and return an empty result.
   */
  async poll(cursor) {
    try {
      const resp = await this.post(
        "ilink/bot/getupdates",
        { get_updates_buf: cursor, base_info: { channel_version: this.channelVersion } },
        this.longPollTimeoutMs + 1e4
      );
      if (resp.errcode === ERRCODE_SESSION_EXPIRED) {
        return { messages: [], sessionExpired: true };
      }
      const messages = [];
      for (const m of resp.msgs ?? []) {
        const msg = await this.toInbound(m);
        if (msg) messages.push(msg);
      }
      return {
        messages,
        cursor: resp.get_updates_buf || void 0,
        sessionExpired: false
      };
    } catch (e) {
      if (e instanceof HttpError && e.timeout) {
        return { messages: [], sessionExpired: false };
      }
      return { messages: [], sessionExpired: false, error: String(e?.message ?? e) };
    }
  }
  /** Filter/parse a raw message into the inbound structure (including media download + decryption) */
  async toInbound(m) {
    if (m.message_type === MSG_TYPE_BOT) return null;
    if (m.message_type !== 0 && m.message_type !== MSG_TYPE_USER) return null;
    const from = (m.from_user_id ?? "").trim();
    if (!from) return null;
    const items = m.item_list ?? [];
    const text = extractText(items);
    const { attachments, failures: attachmentFailures } = await this.collectMedia(items, `msg_${m.message_id ?? m.create_time_ms ?? 0}`);
    if (!text.trim() && attachments.length === 0 && attachmentFailures.length === 0) return null;
    return {
      from,
      messageId: m.message_id ? String(m.message_id) : `${m.create_time_ms ?? Date.now()}`,
      timeMs: m.create_time_ms ?? Date.now(),
      text,
      attachments,
      attachmentFailures,
      raw: m
    };
  }
  /** Download and decrypt media in the message; failures are recorded with a reason, text still comes through */
  async collectMedia(items, prefix) {
    const attachments = [];
    const failures = [];
    const cdnBase = this.opts.cdnBase.replace(/\/$/, "");
    if (!cdnBase) return { attachments, failures };
    const tasks = [];
    const grab = (media, aesKeyB64, kind, name, mime) => {
      const enc = (media?.encrypt_query_param ?? "").trim();
      if (!enc) return;
      const key = aesKeyB64 ? parseAesKey(aesKeyB64) : null;
      const url = downloadUrl(cdnBase, enc);
      tasks.push(
        this.transport.get(url, {}, 6e4).then((r) => {
          if (r.status !== 200) {
            failures.push({ kind, name, reason: `http ${r.status}` });
            return;
          }
          if (r.body.byteLength > MAX_DOWNLOAD_BYTES) {
            failures.push({ kind, name, reason: `too large (${(r.body.byteLength / 1048576).toFixed(1)}MB, limit 100MB)` });
            return;
          }
          let buf = Buffer.from(r.body);
          if (key) buf = decryptEcb(buf, key);
          attachments.push({ kind, name, mime, data: new Uint8Array(buf) });
        }).catch((e) => {
          failures.push({ kind, name, reason: String(e?.message ?? e) });
        })
      );
    };
    for (const it of items) {
      switch (it.type) {
        case ITEM_IMAGE: {
          const img = it.image_item;
          if (!img?.media) break;
          let keyB64 = img.media.aes_key;
          if (img.aeskey) {
            const raw = Buffer.from(img.aeskey, "hex");
            if (raw.length === 16) keyB64 = raw.toString("base64");
          }
          grab(img.media, keyB64, "image", `image_${prefix}_${attachments.length}.bin`, "image/*");
          break;
        }
        case ITEM_FILE: {
          const f = it.file_item;
          if (!f?.media) break;
          grab(f.media, f.media.aes_key, "file", f.file_name || "attachment.bin", "application/octet-stream");
          break;
        }
        case ITEM_VIDEO: {
          const v = it.video_item;
          if (!v?.media) break;
          grab(v.media, v.media.aes_key, "video", `video_${prefix}_${attachments.length}.mp4`, "video/mp4");
          break;
        }
        case ITEM_VOICE: {
          const v = it.voice_item;
          if (!v?.media || (v.text ?? "").trim()) break;
          grab(v.media, v.media.aes_key, "audio", `voice_${prefix}_${attachments.length}.silk`, "audio/silk");
          break;
        }
      }
    }
    await Promise.all(tasks);
    return { attachments, failures };
  }
  /** Send text (auto-chunked at 3800 characters, 100ms between chunks) */
  async sendText(to, text, contextToken, chunkSize = 3800) {
    if (!contextToken.trim()) {
      return { ok: false, ret: 0, errcode: 0, errmsg: "missing context_token: the user must message the bot first" };
    }
    const chunks = splitByCodePoints(text, chunkSize);
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await sleep(100);
      const res = await this.sendOneText(to, chunks[i], contextToken);
      if (!res.ok) return res;
    }
    return { ok: true, ret: 0, errcode: 0, errmsg: "" };
  }
  async sendOneText(to, text, contextToken) {
    const clientId = `wct-${randomHex(6)}`;
    const body = {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: clientId,
        message_type: MSG_TYPE_BOT,
        message_state: MSG_STATE_FINISH,
        item_list: [{ type: ITEM_TEXT, text_item: { text } }],
        context_token: contextToken
      },
      base_info: { channel_version: this.channelVersion }
    };
    try {
      const resp = await this.transport.post(`${this.opts.baseUrl.replace(/\/$/, "")}/ilink/bot/sendmessage`, this.authHeaders(), JSON.stringify(body), 15e3);
      const text0 = bodyText(resp);
      let parsed = {};
      try {
        parsed = JSON.parse(text0);
      } catch {
      }
      let ok = false;
      if (typeof parsed.ret === "number") ok = parsed.ret === 0;
      else if (typeof parsed.errcode === "number") ok = parsed.errcode === 0;
      else ok = resp.status === 200 && !parsed.errmsg;
      return { ok, ret: parsed.ret ?? 0, errcode: parsed.errcode ?? 0, errmsg: parsed.errmsg ?? "", raw: text0.slice(0, 300) };
    } catch (e) {
      return { ok: false, ret: -1, errcode: 0, errmsg: String(e?.message ?? e) };
    }
  }
  /** Fetch per-user bot config; typing_ticket is the credential sendtyping needs (TTL handled by the caller) */
  async getConfig(ilinkUserId, contextToken) {
    try {
      const resp = await this.post(
        "ilink/bot/getconfig",
        { ilink_user_id: ilinkUserId, context_token: contextToken, base_info: { channel_version: this.channelVersion } },
        1e4
      );
      return { typingTicket: (resp.typing_ticket ?? "").trim() };
    } catch {
      return { typingTicket: "" };
    }
  }
  /** Show/cancel the "typing" indicator in the user's chat. Best-effort: returns false on any failure */
  async sendTyping(ilinkUserId, typingTicket, active) {
    if (!typingTicket.trim()) return false;
    try {
      await this.post(
        "ilink/bot/sendtyping",
        {
          ilink_user_id: ilinkUserId,
          typing_ticket: typingTicket,
          status: active ? 1 : 2,
          // 1 = typing, 2 = cancel
          base_info: { channel_version: this.channelVersion }
        },
        1e4
      );
      return true;
    } catch {
      return false;
    }
  }
  /** Send one media/file attachment: AES-ECB encrypt -> getuploadurl -> CDN upload -> sendmessage */
  async sendMedia(to, att, contextToken) {
    try {
      if (!contextToken.trim()) {
        throw new Error("missing context_token: the user must message the bot first");
      }
      if (!att.data.length) throw new Error("empty attachment");
      if (att.data.length > MAX_UPLOAD_BYTES) {
        throw new Error(`attachment too large: ${(att.data.length / 1048576).toFixed(1)}MB (limit 100MB)`);
      }
      const ref = await this.uploadToCdn(to, att);
      const item = buildMediaItem(att, ref);
      const body = {
        msg: {
          from_user_id: "",
          to_user_id: to,
          client_id: `wct-${randomHex(6)}`,
          message_type: MSG_TYPE_BOT,
          message_state: MSG_STATE_FINISH,
          item_list: [item],
          context_token: contextToken
        },
        base_info: { channel_version: this.channelVersion }
      };
      const resp = await this.transport.post(
        `${this.opts.baseUrl.replace(/\/$/, "")}/ilink/bot/sendmessage`,
        this.authHeaders(),
        JSON.stringify(body),
        15e3
      );
      const text0 = bodyText(resp);
      let parsed = {};
      try {
        parsed = JSON.parse(text0);
      } catch {
      }
      let ok = false;
      if (typeof parsed.ret === "number") ok = parsed.ret === 0;
      else if (typeof parsed.errcode === "number") ok = parsed.errcode === 0;
      else ok = resp.status === 200 && !parsed.errmsg;
      return { ok, ret: parsed.ret ?? 0, errcode: parsed.errcode ?? 0, errmsg: parsed.errmsg ?? "", raw: text0.slice(0, 300) };
    } catch (e) {
      return { ok: false, ret: -1, errcode: 0, errmsg: String(e?.message ?? e) };
    }
  }
  /** Encrypt + CDN upload; returns the CDN reference used in sendmessage */
  async uploadToCdn(to, att) {
    const cdnBase = this.opts.cdnBase.replace(/\/$/, "");
    if (!cdnBase) throw new Error("cdn_base is empty");
    const key = randomBytes16();
    const filekey = randomHex(16);
    const mediaType = att.kind === "image" ? UPLOAD_MEDIA_IMAGE : att.kind === "video" ? UPLOAD_MEDIA_VIDEO : UPLOAD_MEDIA_FILE;
    const plain = Buffer.from(att.data.buffer, att.data.byteOffset, att.data.byteLength);
    const cipher = Buffer.allocUnsafeSlow(ecbPaddedSize(plain.length));
    encryptEcbInto(plain, key, cipher);
    const up = await this.post(
      "ilink/bot/getuploadurl",
      {
        filekey,
        media_type: mediaType,
        to_user_id: to,
        rawsize: plain.length,
        rawfilemd5: md5Hex(att.data),
        filesize: ecbPaddedSize(plain.length),
        no_need_thumb: true,
        aeskey: key.toString("hex"),
        // note: hex string here, NOT the base64(hex) used in sendmessage
        base_info: { channel_version: this.channelVersion }
      },
      15e3
    );
    if ((up.errcode ?? 0) !== 0) throw new Error(`getuploadurl errcode=${up.errcode} ${up.errmsg ?? ""}`);
    const uploadUrl = (up.upload_full_url ?? "").trim() || buildCdnUploadUrl(cdnBase, (up.upload_param ?? "").trim(), filekey);
    if (!uploadUrl) throw new Error(`getuploadurl returned neither upload_param nor upload_full_url`);
    const downloadParam = await this.uploadCipher(uploadUrl, cipher);
    return { downloadParam, aesKey: key, cipherSize: cipher.length, rawSize: plain.length };
  }
  /** POST ciphertext to the CDN; the x-encrypted-param response header is the download credential */
  async uploadCipher(url, cipher) {
    let lastErr = "";
    const body = cipher.buffer;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await this.transport.post(url, { "Content-Type": "application/octet-stream" }, body, 12e4);
        if (r.status >= 400 && r.status < 500) {
          const msg = r.headers["x-error-message"] || `http ${r.status}`;
          throw new HttpError(`CDN upload client error: ${msg}`, r.status);
        }
        if (r.status !== 200) {
          lastErr = r.headers["x-error-message"] || `http ${r.status}`;
          continue;
        }
        const dl = (r.headers["x-encrypted-param"] ?? "").trim();
        if (dl) return dl;
        lastErr = "CDN response missing x-encrypted-param header";
      } catch (e) {
        if (attempt === 3 || e instanceof HttpError && e.status >= 400 && e.status < 500) throw e;
        lastErr = String(e?.message ?? e);
      }
    }
    throw new Error(`CDN upload failed after 3 attempts: ${lastErr}`);
  }
  /** Headers shared by getupdates/sendmessage */
  authHeaders() {
    const headers = {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": this.randomUin()
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }
};
function extractText(items) {
  if (!items.length) return "";
  for (const item of items) {
    switch (item.type) {
      case ITEM_TEXT: {
        const text = (item.text_item?.text ?? "").trim();
        const ref = item.ref_msg;
        if (!ref) return text;
        const isMediaRef = ref.message_item && [ITEM_IMAGE, ITEM_VOICE, ITEM_FILE, ITEM_VIDEO].includes(ref.message_item.type ?? 0);
        if (isMediaRef) return text;
        const parts = [];
        if (ref.title) parts.push(ref.title);
        if (ref.message_item) {
          const refBody = extractText([ref.message_item]);
          if (refBody) parts.push(refBody);
        }
        if (!parts.length) return text;
        return `[Quote: ${parts.join(" | ")}]
${text}`;
      }
      case ITEM_VOICE: {
        const t2 = (item.voice_item?.text ?? "").trim();
        if (t2) return t2;
        break;
      }
    }
  }
  return "";
}
function splitByCodePoints(s, max) {
  const cps = Array.from(s);
  if (cps.length <= max) return [s];
  const out = [];
  for (let i = 0; i < cps.length; i += max) out.push(cps.slice(i, i + max).join(""));
  return out;
}
function randomHex(n) {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
function sleep(ms) {
  return new Promise((r) => window.setTimeout(r, ms));
}
var MAX_UPLOAD_BYTES = 100 << 20;
var MAX_DOWNLOAD_BYTES = MAX_UPLOAD_BYTES;
function randomBytes16() {
  const b = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}
function buildCdnUploadUrl(cdnBase, uploadParam, filekey) {
  return `${cdnBase.replace(/\/$/, "")}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;
}
function aesKeyForApi(key) {
  return Buffer.from(key.toString("hex")).toString("base64");
}
var VIDEO_EXTS = /* @__PURE__ */ new Set(["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "webm"]);
function isVideoExt(ext) {
  return VIDEO_EXTS.has(ext.toLowerCase());
}
function buildMediaItem(att, ref) {
  const media = {
    encrypt_query_param: ref.downloadParam,
    aes_key: aesKeyForApi(ref.aesKey),
    encrypt_type: 1
  };
  switch (att.kind) {
    case "image":
      return { type: ITEM_IMAGE, image_item: { media, mid_size: ref.cipherSize } };
    case "video":
      return { type: ITEM_VIDEO, video_item: { media, video_size: ref.cipherSize } };
    default:
      return { type: ITEM_FILE, file_item: { media, file_name: att.name, len: String(ref.rawSize) } };
  }
}

// src/core/transport-obsidian.ts
var import_obsidian = require("obsidian");
var ObsidianTransport = class {
  async get(url, headers, timeoutMs) {
    return this.run("GET", url, headers, void 0, timeoutMs);
  }
  async post(url, headers, body, timeoutMs) {
    return this.run("POST", url, headers, body, timeoutMs);
  }
  async run(method, url, headers, body, timeoutMs) {
    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new HttpError("request timeout", 0, true)), timeoutMs);
    });
    try {
      const resp = await Promise.race([
        (0, import_obsidian.requestUrl)({ url, method, headers, body, throw: false }),
        timeoutPromise
      ]);
      return { status: resp.status, body: resp.arrayBuffer, headers: lowerHeaders(resp.headers) };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const msg = String(e?.message ?? e);
      throw new HttpError(msg, 0, /abort|timeout|timed out/i.test(msg));
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  }
};

// src/core/transport-node.ts
var http = __toESM(require("http"));
var https = __toESM(require("https"));
var MAX_REDIRECTS = 5;
var NodeTransport = class {
  async get(url, headers, timeoutMs) {
    return this.request("GET", url, headers, void 0, timeoutMs, 0);
  }
  async post(url, headers, body, timeoutMs) {
    return this.request("POST", url, headers, body, timeoutMs, 0);
  }
  request(method, url, headers, body, timeoutMs, redirects) {
    return new Promise((resolve, reject) => {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        reject(new HttpError(`invalid url: ${url}`));
        return;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        reject(new HttpError(`unsupported protocol: ${parsed.protocol}`));
        return;
      }
      const mod = parsed.protocol === "http:" ? http : https;
      let settled = false;
      let deadline;
      const arm = () => {
        if (deadline) window.clearTimeout(deadline);
        deadline = window.setTimeout(() => {
          req.destroy(new HttpError("request timeout", 0, true));
        }, timeoutMs);
      };
      const settle = (fn) => {
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
          if ([301, 302, 303, 307, 308].includes(status) && redirects < MAX_REDIRECTS) {
            const loc = res.headers.location;
            res.resume();
            if (loc) {
              settled = true;
              window.clearTimeout(deadline);
              const nextMethod = method === "POST" && status !== 307 && status !== 308 ? "GET" : method;
              const nextBody = nextMethod === "GET" ? void 0 : body;
              this.request(nextMethod, new URL(loc, parsed).toString(), headers, nextBody, timeoutMs, redirects + 1).then(
                resolve,
                reject
              );
              return;
            }
          }
          const chunks = [];
          res.on("data", (c) => {
            arm();
            chunks.push(c);
          });
          res.on("error", (e) => settle(() => reject(new HttpError(String(e?.message ?? e), status))));
          res.on("end", () => {
            settle(() => {
              const buf = Buffer.concat(chunks);
              const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
              resolve({ status, body: ab, headers: flatHeaders(res.headers) });
            });
          });
        }
      );
      req.on("timeout", () => req.destroy(new HttpError("request timeout", 0, true)));
      req.on("error", (e) => {
        settle(() => {
          if (e instanceof HttpError) reject(e);
          const msg = String(e?.message ?? e);
          reject(new HttpError(msg, 0, /timeout|timed out|ECONNRESET|ETIMEDOUT|ECONNREFUSED|abort/i.test(msg)));
        });
      });
      if (body !== void 0) req.write(Buffer.from(body instanceof ArrayBuffer ? new Uint8Array(body) : body));
      req.end();
    });
  }
};
function flatHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === void 0) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

// src/core/store.ts
var DEDUP_KEEP = 2e3;
var StateStore = class {
  constructor(app, file, legacyFile) {
    this.app = app;
    this.file = file;
    this.legacyFile = legacyFile;
    this.state = this.load();
  }
  state;
  /** index over state.dedup so lookups are O(1) instead of scanning the ring per message */
  dedupSet = /* @__PURE__ */ new Set();
  saveTimer = null;
  /** last successful serialization; saves are skipped while the content is unchanged.
   * The poll loop calls saveNow() every round, and on iCloud-synced vaults every
   * write from two devices can fork a "state 2.json" conflict copy — so idle
   * rounds must not touch the disk at all. */
  lastSavedJson = null;
  /** last save error, so a persistent failure is logged once instead of every retry */
  saveError = null;
  emptyState() {
    return {
      token: "",
      botId: "",
      baseUrl: "",
      scannedUser: "",
      cursor: "",
      contextTokens: {},
      pausedUntil: 0,
      dedup: [],
      typingTickets: {},
      lastError: ""
    };
  }
  load() {
    return this.emptyState();
  }
  /** adapter reads are async; await once at plugin startup */
  async init() {
    for (const path of [this.file, this.legacyFile]) {
      if (!path) break;
      try {
        if (await this.app.vault.adapter.exists(path)) {
          const raw = await this.app.vault.adapter.read(path);
          this.state = { ...this.emptyState(), ...JSON.parse(raw) };
          const legacy = this.state;
          const hadLegacy = "quotaTimes" in legacy || "lastPollAt" in legacy;
          delete legacy.quotaTimes;
          delete legacy.lastPollAt;
          this.dedupSet = new Set(this.state.dedup);
          const json = JSON.stringify(this.state);
          this.lastSavedJson = json;
          if (hadLegacy) {
            try {
              await this.app.vault.adapter.write(this.file, json);
            } catch {
            }
          }
          return;
        }
      } catch (e) {
        console.warn(`wechatian: failed to read state from ${path}:`, e);
      }
    }
  }
  get() {
    return this.state;
  }
  update(mutator) {
    mutator(this.state);
    this.scheduleSave();
  }
  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, 300);
  }
  async saveNow() {
    if (this.state.dedup.length > DEDUP_KEEP) {
      this.state.dedup = this.state.dedup.slice(-DEDUP_KEEP);
      this.dedupSet = new Set(this.state.dedup);
    }
    const json = JSON.stringify(this.state);
    if (json === this.lastSavedJson) return;
    try {
      await this.app.vault.adapter.write(this.file, json);
      this.lastSavedJson = json;
      this.saveError = null;
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (msg !== this.saveError) {
        this.saveError = msg;
        console.error(`wechatian: cannot persist state to ${this.file}: ${msg}`);
      }
    }
  }
  /** Message dedup: returns true if this key was already seen */
  seen(key) {
    if (this.dedupSet.has(key)) return true;
    this.dedupSet.add(key);
    this.state.dedup.push(key);
    this.scheduleSave();
    return false;
  }
};

// src/core/importer.ts
var import_obsidian3 = require("obsidian");

// src/core/article.ts
var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
function extractLinks(text) {
  const out = [];
  const re = /https?:\/\/[^\s<>"'，。、）》]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0].replace(/[.,!?;:]+$/, ""));
  }
  return out;
}
async function fetchArticle(transport, url, parseHtml) {
  const resp = await transport.get(
    url,
    {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      // ask for an uncompressed body; bodyTextAuto gunzips as a fallback
      "Accept-Encoding": "identity"
    },
    2e4
  );
  if (resp.status !== 200) throw new Error(`http ${resp.status}`);
  const html = await bodyTextAuto(resp);
  const parse = parseHtml ?? ((h) => new DOMParser().parseFromString(h, "text/html"));
  const doc = parse(html);
  const title = doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? doc.title ?? "";
  if (!title.trim()) throw new Error("no title found on page");
  const description = doc.querySelector('meta[property="og:description"]')?.getAttribute("content") ?? doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
  const root = doc.querySelector("#js_content") ?? doc.body;
  const images = [];
  const markdown = normalizeBlocks(toMd(root, images));
  await downloadImages(transport, images);
  return { url, title: cleanText(title), description: cleanText(description), account: accountName(doc), markdown, images };
}
function accountName(doc) {
  return doc.querySelector("#js_name")?.textContent?.trim() ?? "";
}
async function downloadImages(transport, images) {
  for (const img of images) {
    for (let attempt = 0; attempt < 2 && !img.data; attempt++) {
      if (attempt > 0) await sleep2(1500);
      try {
        const resp = await transport.get(img.url, { "User-Agent": UA }, 2e4);
        if (resp.status === 200) {
          img.data = new Uint8Array(resp.body);
        } else {
          console.warn(`wechatian: article image HTTP ${resp.status}: ${img.url}`);
        }
      } catch (e) {
        console.warn(`wechatian: article image download failed: ${String(e?.message ?? e)}`, img.url);
      }
    }
    await sleep2(400);
  }
}
function sleep2(ms) {
  return new Promise((r) => window.setTimeout(r, ms));
}
var BLOCK_TAGS = /* @__PURE__ */ new Set([
  "p",
  "div",
  "section",
  "article",
  "figure",
  "figcaption",
  "ul",
  "ol",
  "table",
  "pre",
  "hr"
]);
function toMd(node, images) {
  if (node.nodeType === 3) return collapseWs(node.textContent ?? "");
  if (node.nodeType !== 1) return "";
  const el = node;
  const tag = el.tagName.toLowerCase();
  const inner = () => Array.from(el.childNodes).map((n) => toMd(n, images)).join("");
  switch (tag) {
    case "img": {
      const src = el.getAttribute("data-src") ?? el.getAttribute("src") ?? "";
      if (!src || src.startsWith("data:")) return "";
      if (images.length >= 10) {
        console.warn(`wechatian: article image cap (10) reached, keeping remote link: ${src}`);
        return `![image](${src})`;
      }
      images.push({ url: src, ext: imageExt(src), data: null });
      return ` ![[img:${images.length - 1}]] `;
    }
    case "br":
      return "\n";
    case "strong":
    case "b":
      return `**${inner()}**`;
    case "em":
    case "i":
      return `*${inner()}*`;
    case "code":
      return `\`${(el.textContent ?? "").trim()}\``;
    case "a": {
      const href = el.getAttribute("href") ?? "";
      const text = cleanText(inner());
      return href.startsWith("http") && text ? `[${text}](${href})` : text;
    }
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Number(tag[1]);
      return `

${"#".repeat(level)} ${cleanText(inner())}

`;
    }
    case "li":
      return `
- ${cleanText(inner())}`;
    case "blockquote":
      return `

> ${cleanText(inner())}

`;
    case "pre":
      return `

\`\`\`
${(el.textContent ?? "").trim()}
\`\`\`

`;
    case "script":
    case "style":
    case "svg":
      return "";
    default:
      if (BLOCK_TAGS.has(tag)) return `

${inner()}

`;
      return inner();
  }
}
function normalizeBlocks(md) {
  return md.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function collapseWs(s) {
  return s.replace(/\s+/g, " ");
}
function cleanText(s) {
  return s.replace(/\s+/g, " ").trim();
}
function imageExt(src) {
  const fmt = /[?&]wx_fmt=([a-z]+)/i.exec(src)?.[1];
  if (fmt) return fmt.toLowerCase() === "jpeg" ? "jpg" : fmt.toLowerCase();
  const m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(src.split("/").pop() ?? "");
  const ext = m?.[1]?.toLowerCase() ?? "";
  return ["jpg", "jpeg", "png", "gif", "webp"].includes(ext) ? ext : "jpg";
}

// src/i18n.ts
var import_obsidian2 = require("obsidian");
var en = {
  "cmd.connect": "Connect WeChat",
  "cmd.disconnect": "Disconnect WeChat",
  "cmd.login": "Re-scan QR code to log in",
  "cmd.inbox": "Open today's inbox",
  "notice.notLoggedIn": 'Wechatian: not logged in \u2014 run the command "{{cmd}}"',
  "notice.loggedIn": "Wechatian: logged in, receiving messages",
  "notice.loggedOut": "Wechatian: logged out \u2014 re-scan in the settings page",
  "notice.sessionExpired": "Wechatian: WeChat session expired \u2014 please re-scan to log in",
  "error.sessionExpired": "Session expired (-14); please re-scan to log in",
  "notice.importFailed": "Wechatian: import failed {{err}}",
  "notice.noMsgToday": "No messages today ({{path}})",
  "notice.prefix": "WeChat",
  "notice.attachments": "{{n}} attachment(s)",
  "status.disconnected": "disconnected",
  "status.connecting": "connecting",
  "status.connected": "WeChat online",
  "status.expired": "session expired",
  "status.error": "connection error",
  "set.language": "Language",
  "set.language.desc": "Interface language for settings, commands, and notifications",
  "set.language.system": "Follow Obsidian",
  "set.autoConnect": "Auto-connect on startup",
  "set.autoConnect.desc": "Automatically log in and start receiving WeChat messages when Obsidian launches",
  "set.inboxFolder": "Inbox folder",
  "set.inboxFolder.desc": "Folder for the daily message notes",
  "set.attachmentFolder": "Attachment folder",
  "set.attachmentFolder.desc": "Folder for images/files/videos/voice messages",
  "set.articleFolder": "Article folder",
  "set.articleFolder.desc": "Folder for official-account/web article notes",
  "set.outboxFolder": "Outbox folder",
  "set.outboxFolder.desc": "A one-to-one channel to yourself: an agent writes files here \u2014 .md sends its content as text, images/videos/documents are sent as attachments \u2014 each file is deleted after a successful send",
  "set.autoImport": "Auto-import messages",
  "set.autoImport.desc": "Write messages into the inbox as soon as they arrive",
  "set.fetchArticles": "Fetch article info",
  "set.fetchArticles.desc": "Automatically fetch the title/summary of links in messages and create article notes",
  "set.groupByAccount": "Group articles by account",
  "set.groupByAccount.desc": "Store article notes in a subfolder named after the official account, with its images in an assets subfolder inside it",
  "set.notify": "Notify on message",
  "set.autoReply": "Always reply on receipt",
  "set.autoReply.desc": "After a message is recorded, send a confirmation reply back to WeChat \u2014 e.g. where an image or article was saved. May be rate-limited by the gateway if you receive many messages.",
  "set.footer": "Note: this plugin talks to the WeChat ilink gateway directly; messages are stored only in this vault. Proactive sends are rate-limited by the gateway.",
  "login.status": "Login status",
  "login.bound": "Bound \xB7 bot {{bot}} \xB7 scanning user {{user}}",
  "login.rescan": "Re-scan",
  "login.logout": "Log out",
  "login.notLoggedIn": "Not logged in to WeChat yet. Scan the QR code below to bind:",
  "login.fetching": "Fetching QR code\u2026",
  "login.waiting": "Waiting for scan\u2026",
  "login.scanned": "Scanned \u2014 please confirm on your phone\u2026",
  "login.success": "Logged in",
  "modal.title": "WeChat Scan Login",
  "modal.hint": "Scan the QR code below with WeChat, then confirm login on your phone.",
  "modal.renderFailed": "Failed to render QR code: {{err}}",
  "modal.openLink": "or tap this link to open on your phone",
  "importer.attachFailed": "Failed to save attachment: {{name}}",
  "importer.received": "received",
  "importer.sent": "sent",
  "importer.source": "Source",
  "importer.imported": "Imported",
  "importer.from": "From",
  "importer.summary": "Summary",
  "importer.inboxTitle": "{{date}} WeChat Inbox",
  "outbox.failedNote": "Wechatian send failed: ret={{ret}} {{msg}}",
  "qr.missingInResponse": "get_bot_qrcode response missing QR code: {{resp}}",
  "qr.refreshFailed": "Failed to refresh QR code: {{err}}",
  "qr.queryFailed": "Failed to query scan status: {{err}}",
  "qr.expiredMultiple": "QR code expired multiple times, please retry",
  "qr.confirmMissingCreds": "Login confirmed but credentials missing",
  "qr.timeout": "Timed out waiting for scan, please retry",
  "sendTest.name": "Test send",
  "sendTest.desc": "Sends to your own bound WeChat account (one-to-one channel)",
  "sendTest.send": "Send",
  "sendTest.placeholder": "Type a message",
  "sendTest.ok": "Message sent",
  "sendTest.empty": "Nothing to send",
  "sendTest.failed": "Send failed: {{err}}",
  "sendTest.notBound": "Not logged in yet",
  "sendTest.needFirstMessage": "No send credential yet \u2014 send any message to the bot from WeChat first, then retry",
  "reply.done": "Received and saved",
  "reply.attachment.failed": "failed to save attachment",
  "reply.article.failed": "failed to fetch article",
  "reply.recordFailed": "Message received, but recording it to the vault failed.",
  "err.noToken": "No send credential yet",
  "err.noToken.hint": "Replying requires a context token handed out by WeChat: first send any message to the bot from WeChat, then retry.",
  "err.rateLimited": "Send rejected (rate limit or no permission)",
  "err.rateLimited.hint": "The gateway rate-limits proactive sends. Wait a few minutes and retry.",
  "err.network": "Network error",
  "err.network.hint": "Check the network/connection, then retry.",
  "err.sessionExpired": "WeChat session expired",
  "err.sessionExpired.hint": "Re-scan the QR code to log in again, then retry.",
  "err.unknown": "Send failed: ret={{ret}} {{errmsg}}",
  "err.unknown.hint": "Check the network and gateway status, then retry.",
  "set.agentGuide": "Agent guide",
  "set.agentGuide.desc": "Point your agent (Claude etc.) at {{path}} in the vault \u2014 it explains how to send WeChat messages and attachments through the outbox"
};
var zh = {
  "cmd.connect": "\u8FDE\u63A5\u5FAE\u4FE1",
  "cmd.disconnect": "\u65AD\u5F00\u5FAE\u4FE1",
  "cmd.login": "\u91CD\u65B0\u626B\u7801\u767B\u5F55",
  "cmd.inbox": "\u6253\u5F00\u4ECA\u65E5\u6536\u4EF6\u7BB1",
  "notice.notLoggedIn": "Wechatian:\u5C1A\u672A\u767B\u5F55,\u8FD0\u884C\u547D\u4EE4\u300C{{cmd}}\u300D",
  "notice.loggedIn": "Wechatian: \u767B\u5F55\u6210\u529F,\u5F00\u59CB\u63A5\u6536\u6D88\u606F",
  "notice.loggedOut": "Wechatian: \u5DF2\u767B\u51FA,\u8BF7\u5728\u8BBE\u7F6E\u9875\u91CD\u65B0\u626B\u7801",
  "notice.sessionExpired": "Wechatian: \u5FAE\u4FE1\u4F1A\u8BDD\u8FC7\u671F,\u8BF7\u91CD\u65B0\u626B\u7801\u767B\u5F55",
  "error.sessionExpired": "\u4F1A\u8BDD\u8FC7\u671F(-14),\u8BF7\u91CD\u65B0\u626B\u7801\u767B\u5F55",
  "notice.importFailed": "Wechatian: \u5BFC\u5165\u5931\u8D25 {{err}}",
  "notice.noMsgToday": "\u4ECA\u65E5\u6682\u65E0\u6D88\u606F({{path}})",
  "notice.prefix": "\u5FAE\u4FE1",
  "notice.attachments": "{{n}} \u4E2A\u9644\u4EF6",
  "status.disconnected": "\u672A\u8FDE\u63A5",
  "status.connecting": "\u8FDE\u63A5\u4E2D",
  "status.connected": "\u5FAE\u4FE1\u5728\u7EBF",
  "status.expired": "\u4F1A\u8BDD\u8FC7\u671F",
  "status.error": "\u8FDE\u63A5\u9519\u8BEF",
  "set.language": "\u8BED\u8A00",
  "set.language.desc": "\u8BBE\u7F6E\u9875\u3001\u547D\u4EE4\u4E0E\u901A\u77E5\u7684\u754C\u9762\u8BED\u8A00",
  "set.language.system": "\u8DDF\u968F Obsidian",
  "set.autoConnect": "\u542F\u52A8\u65F6\u81EA\u52A8\u8FDE\u63A5",
  "set.autoConnect.desc": "Obsidian \u542F\u52A8\u540E\u81EA\u52A8\u767B\u5F55\u5E76\u5F00\u59CB\u63A5\u6536\u5FAE\u4FE1\u6D88\u606F",
  "set.inboxFolder": "\u6536\u4EF6\u7BB1\u76EE\u5F55",
  "set.inboxFolder.desc": "\u6BCF\u65E5\u6D88\u606F\u7B14\u8BB0\u5B58\u653E\u76EE\u5F55",
  "set.attachmentFolder": "\u9644\u4EF6\u76EE\u5F55",
  "set.attachmentFolder.desc": "\u56FE\u7247/\u6587\u4EF6/\u89C6\u9891/\u8BED\u97F3\u5B58\u653E\u76EE\u5F55",
  "set.articleFolder": "\u6587\u7AE0\u76EE\u5F55",
  "set.articleFolder.desc": "\u516C\u4F17\u53F7/\u7F51\u9875\u6587\u7AE0\u7B14\u8BB0\u5B58\u653E\u76EE\u5F55",
  "set.outboxFolder": "\u53D1\u4EF6\u7BB1\u76EE\u5F55",
  "set.outboxFolder.desc": "\u7ED9\u81EA\u5DF1\u7684\u5355\u5411\u901A\u9053:agent \u5728\u6B64\u5199\u5165\u6587\u4EF6,.md \u4F5C\u4E3A\u6587\u672C\u6D88\u606F\u53D1\u9001,\u56FE\u7247/\u89C6\u9891/\u6587\u6863\u4F5C\u4E3A\u9644\u4EF6\u53D1\u9001,\u53D1\u9001\u6210\u529F\u540E\u5220\u9664\u6587\u4EF6",
  "set.autoImport": "\u81EA\u52A8\u5BFC\u5165\u6D88\u606F",
  "set.autoImport.desc": "\u6536\u5230\u6D88\u606F\u540E\u7ACB\u5373\u5199\u5165\u6536\u4EF6\u7BB1",
  "set.fetchArticles": "\u6293\u53D6\u6587\u7AE0\u4FE1\u606F",
  "set.fetchArticles.desc": "\u6D88\u606F\u91CC\u7684\u94FE\u63A5\u81EA\u52A8\u6293\u53D6\u6807\u9898/\u6458\u8981\u5E76\u5EFA\u7ACB\u6587\u7AE0\u7B14\u8BB0",
  "set.groupByAccount": "\u6309\u516C\u4F17\u53F7\u5206\u76EE\u5F55",
  "set.groupByAccount.desc": "\u6587\u7AE0\u7B14\u8BB0\u5B58\u5165\u4EE5\u516C\u4F17\u53F7\u547D\u540D\u7684\u5B50\u76EE\u5F55,\u6587\u7AE0\u914D\u56FE\u5B58\u5230\u8BE5\u76EE\u5F55\u4E0B\u7684 assets \u5B50\u76EE\u5F55",
  "set.notify": "\u6765\u6D88\u606F\u65F6\u901A\u77E5",
  "set.autoReply": "\u603B\u662F\u56DE\u590D",
  "set.autoReply.desc": "\u6D88\u606F\u8BB0\u5F55\u5165\u5E93\u540E,\u81EA\u52A8\u56DE\u590D\u4E00\u6761\u786E\u8BA4\u6D88\u606F(\u5982\u56FE\u7247/\u6587\u7AE0\u7684\u4FDD\u5B58\u4F4D\u7F6E)\u3002\u6D88\u606F\u8F83\u591A\u65F6\u53EF\u80FD\u89E6\u53D1\u7F51\u5173\u9650\u6D41\u3002",
  "set.footer": "\u8BF4\u660E:\u672C\u63D2\u4EF6\u76F4\u63A5\u4E0E\u5FAE\u4FE1 ilink \u7F51\u5173\u901A\u4FE1,\u6D88\u606F\u4EC5\u4FDD\u5B58\u5728\u672C vault\u3002\u4E3B\u52A8\u53D1\u9001\u53D7\u7F51\u5173\u9650\u6D41\u3002",
  "login.status": "\u767B\u5F55\u72B6\u6001",
  "login.bound": "\u5DF2\u7ED1\u5B9A \xB7 \u673A\u5668\u4EBA {{bot}} \xB7 \u626B\u7801\u7528\u6237 {{user}}",
  "login.rescan": "\u91CD\u65B0\u626B\u7801",
  "login.logout": "\u9000\u51FA\u767B\u5F55",
  "login.notLoggedIn": "\u5C1A\u672A\u767B\u5F55\u5FAE\u4FE1\u3002\u626B\u63CF\u4E0B\u65B9\u4E8C\u7EF4\u7801\u7ED1\u5B9A:",
  "login.fetching": "\u6B63\u5728\u83B7\u53D6\u4E8C\u7EF4\u7801\u2026",
  "login.waiting": "\u7B49\u5F85\u626B\u7801\u2026",
  "login.scanned": "\u5DF2\u626B\u7801,\u8BF7\u5728\u624B\u673A\u4E0A\u786E\u8BA4\u2026",
  "login.success": "\u767B\u5F55\u6210\u529F",
  "modal.title": "\u5FAE\u4FE1\u626B\u7801\u767B\u5F55",
  "modal.hint": "\u7528\u5FAE\u4FE1\u626B\u63CF\u4E0B\u65B9\u4E8C\u7EF4\u7801,\u7136\u540E\u5728\u624B\u673A\u4E0A\u786E\u8BA4\u767B\u5F55\u3002",
  "modal.renderFailed": "\u4E8C\u7EF4\u7801\u6E32\u67D3\u5931\u8D25: {{err}}",
  "modal.openLink": "\u6216\u70B9\u51FB\u6B64\u94FE\u63A5\u5728\u624B\u673A\u6253\u5F00",
  "importer.attachFailed": "\u9644\u4EF6\u4FDD\u5B58\u5931\u8D25: {{name}}",
  "importer.received": "\u63A5\u6536",
  "importer.sent": "\u53D1\u9001",
  "importer.source": "\u6765\u6E90",
  "importer.imported": "\u6536\u5F55\u65F6\u95F4",
  "importer.from": "\u53D1\u9001\u8005",
  "importer.summary": "\u6458\u8981",
  "importer.inboxTitle": "{{date}} \u5FAE\u4FE1\u6536\u4EF6\u7BB1",
  "outbox.failedNote": "Wechatian \u53D1\u9001\u5931\u8D25: ret={{ret}} {{msg}}",
  "qr.missingInResponse": "get_bot_qrcode \u54CD\u5E94\u7F3A\u5C11\u4E8C\u7EF4\u7801: {{resp}}",
  "qr.refreshFailed": "\u4E8C\u7EF4\u7801\u5237\u65B0\u5931\u8D25: {{err}}",
  "qr.queryFailed": "\u67E5\u8BE2\u626B\u7801\u72B6\u6001\u5931\u8D25: {{err}}",
  "qr.expiredMultiple": "\u4E8C\u7EF4\u7801\u591A\u6B21\u8FC7\u671F,\u8BF7\u91CD\u8BD5",
  "qr.confirmMissingCreds": "\u767B\u5F55\u786E\u8BA4\u4F46\u7F3A\u5C11\u51ED\u636E",
  "qr.timeout": "\u7B49\u5F85\u626B\u7801\u8D85\u65F6,\u8BF7\u91CD\u8BD5",
  "sendTest.name": "\u6D4B\u8BD5\u53D1\u9001",
  "sendTest.desc": "\u53D1\u9001\u5230\u4F60\u7ED1\u5B9A\u7684\u5FAE\u4FE1(\u4E00\u5BF9\u4E00\u901A\u9053,\u6536\u4EF6\u4EBA\u5C31\u662F\u4F60\u81EA\u5DF1)",
  "sendTest.send": "\u53D1\u9001",
  "sendTest.placeholder": "\u8F93\u5165\u8981\u53D1\u9001\u7684\u5185\u5BB9",
  "sendTest.ok": "\u6D88\u606F\u5DF2\u53D1\u9001",
  "sendTest.empty": "\u5185\u5BB9\u4E3A\u7A7A,\u6CA1\u6709\u53EF\u53D1\u9001\u7684\u6D88\u606F",
  "sendTest.failed": "\u53D1\u9001\u5931\u8D25: {{err}}",
  "sendTest.notBound": "\u5C1A\u672A\u767B\u5F55",
  "sendTest.needFirstMessage": "\u8FD8\u6CA1\u6709\u53D1\u9001\u51ED\u636E\u2014\u2014\u8BF7\u5148\u4ECE\u5FAE\u4FE1\u7ED9\u673A\u5668\u4EBA\u53D1\u4E00\u6761\u6D88\u606F,\u518D\u91CD\u8BD5",
  "reply.done": "\u6536\u5230,\u5DF2\u5B8C\u6210\u4FDD\u5B58",
  "reply.attachment.failed": "\u9644\u4EF6\u4FDD\u5B58\u5931\u8D25",
  "reply.article.failed": "\u6587\u7AE0\u6293\u53D6\u5931\u8D25",
  "reply.recordFailed": "\u6D88\u606F\u5DF2\u6536\u5230,\u4F46\u5199\u5165 vault \u5931\u8D25\u3002",
  "err.noToken": "\u8FD8\u6CA1\u6709\u53D1\u9001\u51ED\u636E",
  "err.noToken.hint": "\u56DE\u590D\u9700\u8981\u5FAE\u4FE1\u4E0B\u53D1\u7684 context token\u2014\u2014\u5148\u4ECE\u5FAE\u4FE1\u7ED9\u673A\u5668\u4EBA\u53D1\u4EFB\u610F\u4E00\u6761\u6D88\u606F,\u518D\u91CD\u8BD5\u3002",
  "err.rateLimited": "\u53D1\u9001\u88AB\u62D2(\u9650\u6D41\u6216\u65E0\u6743\u9650)",
  "err.rateLimited.hint": "\u7F51\u5173\u5BF9\u4E3B\u52A8\u53D1\u9001\u6709\u9650\u6D41,\u7A0D\u7B49\u51E0\u5206\u949F\u518D\u8BD5\u3002",
  "err.network": "\u7F51\u7EDC\u9519\u8BEF",
  "err.network.hint": "\u68C0\u67E5\u7F51\u7EDC/\u8FDE\u63A5\u540E\u91CD\u8BD5\u3002",
  "err.sessionExpired": "\u5FAE\u4FE1\u4F1A\u8BDD\u8FC7\u671F",
  "err.sessionExpired.hint": "\u91CD\u65B0\u626B\u7801\u767B\u5F55\u540E\u518D\u53D1\u9001\u3002",
  "err.unknown": "\u53D1\u9001\u5931\u8D25: ret={{ret}} {{errmsg}}",
  "err.unknown.hint": "\u68C0\u67E5\u7F51\u7EDC\u548C\u7F51\u5173\u72B6\u6001\u540E\u91CD\u8BD5\u3002",
  "set.agentGuide": "Agent \u6307\u5F15",
  "set.agentGuide.desc": "\u8BA9\u4F60\u7684 agent(Claude \u7B49)\u8BFB\u53D6 vault \u4E2D\u7684 {{path}},\u5373\u53EF\u5B66\u4F1A\u901A\u8FC7\u53D1\u4EF6\u7BB1\u53D1\u9001\u5FAE\u4FE1\u6D88\u606F\u548C\u9644\u4EF6"
};
var tw = {
  "cmd.connect": "\u9023\u63A5\u5FAE\u4FE1",
  "cmd.disconnect": "\u4E2D\u65B7\u5FAE\u4FE1",
  "cmd.login": "\u91CD\u65B0\u6383\u78BC\u767B\u5165",
  "cmd.inbox": "\u958B\u555F\u4ECA\u65E5\u6536\u4EF6\u5323",
  "notice.notLoggedIn": "Wechatian:\u5C1A\u672A\u767B\u5165,\u57F7\u884C\u6307\u4EE4\u300C{{cmd}}\u300D",
  "notice.loggedIn": "Wechatian: \u767B\u5165\u6210\u529F,\u958B\u59CB\u63A5\u6536\u8A0A\u606F",
  "notice.loggedOut": "Wechatian: \u5DF2\u767B\u51FA,\u8ACB\u5728\u8A2D\u5B9A\u9801\u91CD\u65B0\u6383\u78BC",
  "notice.sessionExpired": "Wechatian: \u5FAE\u4FE1\u5DE5\u4F5C\u968E\u6BB5\u904E\u671F,\u8ACB\u91CD\u65B0\u6383\u78BC\u767B\u5165",
  "error.sessionExpired": "\u5DE5\u4F5C\u968E\u6BB5\u904E\u671F(-14),\u8ACB\u91CD\u65B0\u6383\u78BC\u767B\u5165",
  "notice.importFailed": "Wechatian: \u532F\u5165\u5931\u6557 {{err}}",
  "notice.noMsgToday": "\u4ECA\u65E5\u66AB\u7121\u8A0A\u606F({{path}})",
  "notice.prefix": "\u5FAE\u4FE1",
  "notice.attachments": "{{n}} \u500B\u9644\u4EF6",
  "status.disconnected": "\u672A\u9023\u63A5",
  "status.connecting": "\u9023\u63A5\u4E2D",
  "status.connected": "\u5FAE\u4FE1\u5728\u7DDA",
  "status.expired": "\u5DE5\u4F5C\u968E\u6BB5\u904E\u671F",
  "status.error": "\u9023\u63A5\u932F\u8AA4",
  "set.language": "\u8A9E\u8A00",
  "set.language.desc": "\u8A2D\u5B9A\u9801\u3001\u6307\u4EE4\u8207\u901A\u77E5\u7684\u4ECB\u9762\u8A9E\u8A00",
  "set.language.system": "\u8DDF\u96A8 Obsidian",
  "set.autoConnect": "\u555F\u52D5\u6642\u81EA\u52D5\u9023\u63A5",
  "set.autoConnect.desc": "Obsidian \u555F\u52D5\u5F8C\u81EA\u52D5\u767B\u5165\u4E26\u958B\u59CB\u63A5\u6536\u5FAE\u4FE1\u8A0A\u606F",
  "set.inboxFolder": "\u6536\u4EF6\u5323\u76EE\u9304",
  "set.inboxFolder.desc": "\u6BCF\u65E5\u8A0A\u606F\u7B46\u8A18\u5B58\u653E\u76EE\u9304",
  "set.attachmentFolder": "\u9644\u4EF6\u76EE\u9304",
  "set.attachmentFolder.desc": "\u5716\u7247/\u6A94\u6848/\u5F71\u7247/\u8A9E\u97F3\u5B58\u653E\u76EE\u9304",
  "set.articleFolder": "\u6587\u7AE0\u76EE\u9304",
  "set.articleFolder.desc": "\u516C\u773E\u865F/\u7DB2\u9801\u6587\u7AE0\u7B46\u8A18\u5B58\u653E\u76EE\u9304",
  "set.outboxFolder": "\u767C\u4EF6\u5323\u76EE\u9304",
  "set.outboxFolder.desc": "\u7D66\u81EA\u5DF1\u7684\u55AE\u5411\u901A\u9053:agent \u5728\u6B64\u5BEB\u5165\u6A94\u6848,.md \u4F5C\u70BA\u6587\u5B57\u8A0A\u606F\u767C\u9001,\u5716\u7247/\u5F71\u7247/\u6587\u4EF6\u4F5C\u70BA\u9644\u4EF6\u767C\u9001,\u767C\u9001\u6210\u529F\u5F8C\u522A\u9664\u6A94\u6848",
  "set.autoImport": "\u81EA\u52D5\u532F\u5165\u8A0A\u606F",
  "set.autoImport.desc": "\u6536\u5230\u8A0A\u606F\u5F8C\u7ACB\u5373\u5BEB\u5165\u6536\u4EF6\u5323",
  "set.fetchArticles": "\u6293\u53D6\u6587\u7AE0\u8CC7\u8A0A",
  "set.fetchArticles.desc": "\u8A0A\u606F\u88E1\u7684\u9023\u7D50\u81EA\u52D5\u6293\u53D6\u6A19\u984C/\u6458\u8981\u4E26\u5EFA\u7ACB\u6587\u7AE0\u7B46\u8A18",
  "set.groupByAccount": "\u4F9D\u516C\u773E\u865F\u5206\u76EE\u9304",
  "set.groupByAccount.desc": "\u6587\u7AE0\u7B46\u8A18\u5B58\u5165\u4EE5\u516C\u773E\u865F\u547D\u540D\u7684\u5B50\u76EE\u9304,\u6587\u7AE0\u914D\u5716\u5B58\u5230\u8A72\u76EE\u9304\u4E0B\u7684 assets \u5B50\u76EE\u9304",
  "set.notify": "\u4F86\u8A0A\u606F\u6642\u901A\u77E5",
  "set.autoReply": "\u7E3D\u662F\u56DE\u8986",
  "set.autoReply.desc": "\u8A0A\u606F\u8A18\u9304\u5165\u5EAB\u5F8C,\u81EA\u52D5\u56DE\u8986\u4E00\u689D\u78BA\u8A8D\u8A0A\u606F(\u5982\u5716\u7247/\u6587\u7AE0\u7684\u5132\u5B58\u4F4D\u7F6E)\u3002\u8A0A\u606F\u8F03\u591A\u6642\u53EF\u80FD\u89F8\u767C\u9598\u9053\u5668\u9650\u6D41\u3002",
  "set.footer": "\u8AAA\u660E:\u672C\u5916\u639B\u76F4\u63A5\u8207\u5FAE\u4FE1 ilink \u9598\u9053\u5668\u901A\u8A0A,\u8A0A\u606F\u50C5\u5132\u5B58\u5728\u672C vault\u3002\u4E3B\u52D5\u767C\u9001\u53D7\u9598\u9053\u5668\u9650\u6D41\u3002",
  "login.status": "\u767B\u5165\u72C0\u614B",
  "login.bound": "\u5DF2\u7D81\u5B9A \xB7 \u6A5F\u5668\u4EBA {{bot}} \xB7 \u6383\u78BC\u4F7F\u7528\u8005 {{user}}",
  "login.rescan": "\u91CD\u65B0\u6383\u78BC",
  "login.logout": "\u767B\u51FA",
  "login.notLoggedIn": "\u5C1A\u672A\u767B\u5165\u5FAE\u4FE1\u3002\u6383\u63CF\u4E0B\u65B9\u4E8C\u7DAD\u78BC\u7D81\u5B9A:",
  "login.fetching": "\u6B63\u5728\u53D6\u5F97\u4E8C\u7DAD\u78BC\u2026",
  "login.waiting": "\u7B49\u5F85\u6383\u78BC\u2026",
  "login.scanned": "\u5DF2\u6383\u78BC,\u8ACB\u5728\u624B\u6A5F\u4E0A\u78BA\u8A8D\u2026",
  "login.success": "\u767B\u5165\u6210\u529F",
  "modal.title": "\u5FAE\u4FE1\u6383\u78BC\u767B\u5165",
  "modal.hint": "\u7528\u5FAE\u4FE1\u6383\u63CF\u4E0B\u65B9\u4E8C\u7DAD\u78BC,\u7136\u5F8C\u5728\u624B\u6A5F\u4E0A\u78BA\u8A8D\u767B\u5165\u3002",
  "modal.renderFailed": "\u4E8C\u7DAD\u78BC\u7522\u751F\u5931\u6557: {{err}}",
  "modal.openLink": "\u6216\u9EDE\u6B64\u9023\u7D50\u5728\u624B\u6A5F\u958B\u555F",
  "importer.attachFailed": "\u9644\u4EF6\u5132\u5B58\u5931\u6557: {{name}}",
  "importer.received": "\u63A5\u6536",
  "importer.sent": "\u767C\u9001",
  "importer.source": "\u4F86\u6E90",
  "importer.imported": "\u6536\u9304\u6642\u9593",
  "importer.from": "\u767C\u9001\u8005",
  "importer.summary": "\u6458\u8981",
  "importer.inboxTitle": "{{date}} \u5FAE\u4FE1\u6536\u4EF6\u5323",
  "outbox.failedNote": "Wechatian \u767C\u9001\u5931\u6557: ret={{ret}} {{msg}}",
  "qr.missingInResponse": "get_bot_qrcode \u56DE\u61C9\u7F3A\u5C11\u4E8C\u7DAD\u78BC: {{resp}}",
  "qr.refreshFailed": "\u4E8C\u7DAD\u78BC\u91CD\u65B0\u6574\u7406\u5931\u6557: {{err}}",
  "qr.queryFailed": "\u67E5\u8A62\u6383\u78BC\u72C0\u614B\u5931\u6557: {{err}}",
  "qr.expiredMultiple": "\u4E8C\u7DAD\u78BC\u591A\u6B21\u904E\u671F,\u8ACB\u91CD\u8A66",
  "qr.confirmMissingCreds": "\u767B\u5165\u78BA\u8A8D\u4F46\u7F3A\u5C11\u6191\u8B49",
  "qr.timeout": "\u7B49\u5F85\u6383\u78BC\u903E\u6642,\u8ACB\u91CD\u8A66",
  "sendTest.name": "\u6E2C\u8A66\u767C\u9001",
  "sendTest.desc": "\u767C\u9001\u5230\u4F60\u7D81\u5B9A\u7684\u5FAE\u4FE1(\u4E00\u5C0D\u4E00\u901A\u9053,\u6536\u4EF6\u4EBA\u5C31\u662F\u4F60\u81EA\u5DF1)",
  "sendTest.send": "\u767C\u9001",
  "sendTest.placeholder": "\u8F38\u5165\u8981\u767C\u9001\u7684\u5167\u5BB9",
  "sendTest.ok": "\u8A0A\u606F\u5DF2\u767C\u9001",
  "sendTest.empty": "\u5167\u5BB9\u70BA\u7A7A,\u6C92\u6709\u53EF\u767C\u9001\u7684\u8A0A\u606F",
  "sendTest.failed": "\u767C\u9001\u5931\u6557: {{err}}",
  "sendTest.notBound": "\u5C1A\u672A\u767B\u5165",
  "sendTest.needFirstMessage": "\u9084\u6C92\u6709\u767C\u9001\u6191\u8B49\u2014\u2014\u8ACB\u5148\u5F9E\u5FAE\u4FE1\u7D66\u6A5F\u5668\u4EBA\u767C\u4E00\u689D\u8A0A\u606F,\u518D\u91CD\u8A66",
  "reply.done": "\u6536\u5230,\u5DF2\u5B8C\u6210\u5132\u5B58",
  "reply.attachment.failed": "\u9644\u4EF6\u5132\u5B58\u5931\u6557",
  "reply.article.failed": "\u6587\u7AE0\u6293\u53D6\u5931\u6557",
  "reply.recordFailed": "\u8A0A\u606F\u5DF2\u6536\u5230,\u4F46\u5BEB\u5165 vault \u5931\u6557\u3002",
  "err.noToken": "\u9084\u6C92\u6709\u767C\u9001\u6191\u8B49",
  "err.noToken.hint": "\u56DE\u8986\u9700\u8981\u5FAE\u4FE1\u4E0B\u767C\u7684 context token\u2014\u2014\u8ACB\u5148\u5F9E\u5FAE\u4FE1\u7D66\u6A5F\u5668\u4EBA\u767C\u4EFB\u610F\u4E00\u689D\u8A0A\u606F,\u518D\u91CD\u8A66\u3002",
  "err.rateLimited": "\u767C\u9001\u88AB\u62D2(\u9650\u6D41\u6216\u7121\u6B0A\u9650)",
  "err.rateLimited.hint": "\u9598\u9053\u5668\u5C0D\u4E3B\u52D5\u767C\u9001\u6709\u9650\u6D41,\u7A0D\u7B49\u5E7E\u5206\u9418\u518D\u8A66\u3002",
  "err.network": "\u7DB2\u8DEF\u932F\u8AA4",
  "err.network.hint": "\u6AA2\u67E5\u7DB2\u8DEF/\u9023\u7DDA\u5F8C\u91CD\u8A66\u3002",
  "err.sessionExpired": "\u5FAE\u4FE1\u5DE5\u4F5C\u968E\u6BB5\u904E\u671F",
  "err.sessionExpired.hint": "\u91CD\u65B0\u6383\u78BC\u767B\u5165\u5F8C\u518D\u767C\u9001\u3002",
  "err.unknown": "\u767C\u9001\u5931\u6557: ret={{ret}} {{errmsg}}",
  "err.unknown.hint": "\u6AA2\u67E5\u7DB2\u8DEF\u548C\u9598\u9053\u5668\u72C0\u614B\u5F8C\u91CD\u8A66\u3002",
  "set.agentGuide": "Agent \u6307\u5F15",
  "set.agentGuide.desc": "\u8B93\u4F60\u7684 agent(Claude \u7B49)\u8B80\u53D6 vault \u4E2D\u7684 {{path}},\u5373\u53EF\u5B78\u6703\u900F\u904E\u767C\u4EF6\u5323\u767C\u9001\u5FAE\u4FE1\u8A0A\u606F\u548C\u9644\u4EF6"
};
function detectDict() {
  try {
    const lang = (0, import_obsidian2.getLanguage)().toLowerCase();
    if (lang.startsWith("zh")) {
      return lang.includes("tw") || lang.includes("hk") || lang.includes("hant") ? tw : zh;
    }
    return en;
  } catch {
    return en;
  }
}
var dict = detectDict();
function applyLanguage(lang) {
  dict = lang === "system" ? detectDict() : lang === "zh" ? zh : lang === "tw" ? tw : en;
}
function resolvedLanguage() {
  return dict === zh ? "zh" : dict === tw ? "tw" : "en";
}
function t(key, vars) {
  let s = dict[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{{${k}}}`, String(v));
    }
  }
  return s;
}
function classifySendFailure(input) {
  const msg = input.errmsg.toLowerCase();
  if (!input.contextToken.trim() || /context[_ ]?token/.test(msg)) return "noToken";
  if (msg.includes("session expired") || msg.includes("\u4F1A\u8BDD\u8FC7\u671F") || msg.includes("\u6703\u8A71\u904E\u671F")) return "sessionExpired";
  if (/fetch failed|network|econn|etimedout|socket hang up|abort/.test(msg)) return "network";
  if (/no permission|permission denied/.test(msg)) return "rateLimited";
  if (input.ret === -14 || input.ret === -20) return "sessionExpired";
  if (input.ret !== 0) return "rateLimited";
  return "unknown";
}
function buildSendFailure(errmsg, ret, contextToken = "") {
  const cat = classifySendFailure({ ret, errmsg, contextToken });
  if (cat === "noToken") return `${t("err.noToken")} \u2014 ${t("err.noToken.hint")}`;
  if (cat === "rateLimited") return `${t("err.rateLimited")} \u2014 ${t("err.rateLimited.hint")}`;
  if (cat === "network") return `${t("err.network")} \u2014 ${t("err.network.hint")}`;
  if (cat === "sessionExpired") return `${t("err.sessionExpired")} \u2014 ${t("err.sessionExpired.hint")}`;
  return `${t("err.unknown", { ret: String(ret), errmsg: errmsg.trim() || "?" })} \u2014 ${t("err.unknown.hint")}`;
}
function buildReceiptReplies(results) {
  const lines = [];
  for (const r of results) {
    if (!r.ok) {
      lines.push(t("reply.recordFailed"));
      continue;
    }
    lines.push(t("reply.done"));
    for (const f of r.attachmentFailures) lines.push(`${t("reply.attachment.failed")}: ${f}`);
    for (const reason of r.articleFailures) lines.push(`${t("reply.article.failed")}: ${reason}`);
    if (!r.attachmentPaths.length && !r.attachmentFailures.length && r.linkCount && !r.articleAssets.length && !r.articleFailures.length) {
      lines.push(`${t("reply.article.failed")}: unknown`);
    }
  }
  return [lines.join("\n")];
}

// src/core/importer.ts
function pad(n) {
  return n < 10 ? `0${n}` : String(n);
}
function dayStamp(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function timeOfDay(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, "_").trim() || "untitled";
}
async function uniquePath(app, path) {
  if (!await app.vault.adapter.exists(path)) return path;
  const dot = path.lastIndexOf(".");
  const stem = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : "";
  for (let i = 1; ; i++) {
    const candidate = `${stem}_${i}${ext}`;
    if (!await app.vault.adapter.exists(candidate)) return candidate;
  }
}
async function ensureFolder(app, folder) {
  if (!folder) return;
  if (await app.vault.adapter.exists(folder)) return;
  const parts = folder.split("/").filter(Boolean);
  let cur = "";
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (!await app.vault.adapter.exists(cur)) {
      await app.vault.createFolder(cur);
    }
  }
  void import_obsidian3.TFolder;
}
async function importMessage(app, transport, msg, settings) {
  const result = {
    appended: false,
    dailyNote: "",
    articleAssets: [],
    attachmentPaths: [],
    attachmentFailures: msg.attachmentFailures.map((f) => `${f.name} (${f.reason})`),
    linkCount: 0,
    articleFailures: []
  };
  await ensureFolder(app, settings.inboxFolder);
  await ensureFolder(app, settings.attachmentFolder);
  await ensureFolder(app, settings.articleFolder);
  const lines = [];
  lines.push(`**${timeOfDay(msg.timeMs)}** \xB7 ${t("importer.received")}`);
  const links = extractLinks(msg.text);
  result.linkCount = links.length;
  let display = msg.text.trim();
  if (settings.fetchArticles && links.length) {
    for (const url of links.slice(0, 5)) {
      try {
        const info = await fetchArticle(transport, url, settings.parseHtml);
        const title = info.title;
        const accountDir = settings.groupArticlesByAccount && info.account ? `/${sanitizeFileName(info.account)}` : "";
        const notePath = `${settings.articleFolder}${accountDir}/${dayStamp(msg.timeMs)} ${sanitizeFileName(title)}.md`;
        const mediaFolder = `${settings.articleFolder}${accountDir}/assets`;
        if (!await app.vault.adapter.exists(notePath)) {
          await ensureFolder(app, mediaFolder);
          const base = `${dayStamp(msg.timeMs)}_${timeOfDay(msg.timeMs).replace(":", "")}`;
          let body = info.markdown;
          let savedAssets = 0;
          for (let i = 0; i < info.images.length; i++) {
            const img = info.images[i];
            const ph = `![[img:${i}]]`;
            if (img.data) {
              const path = await uniquePath(app, `${mediaFolder}/${base}_article${i}.${img.ext}`);
              try {
                const ab = img.data.buffer.slice(
                  img.data.byteOffset,
                  img.data.byteOffset + img.data.byteLength
                );
                await app.vault.adapter.writeBinary(path, ab);
                savedAssets++;
                body = body.split(ph).join(`![[${path}]]`);
                continue;
              } catch {
              }
            }
            body = body.split(ph).join(`![image](${img.url})`);
          }
          const note = [
            `# ${title}`,
            "",
            `> **${t("importer.source")}**: ${url}`,
            `> **${t("importer.imported")}**: ${new Date(msg.timeMs).toLocaleString()}`,
            `> **${t("importer.from")}**: ${msg.from}`,
            info.description ? `> **${t("importer.summary")}**: ${info.description}` : "",
            "",
            body,
            ""
          ].join("\n");
          await app.vault.create(notePath, note);
          result.articleAssets.push({ title, note: notePath, assetsDir: mediaFolder, assetCount: savedAssets });
        }
        display = display.split(url).join(`[[${notePath.replace(/\.md$/, "")}|${title}]]`);
      } catch (e) {
        result.articleFailures.push(String(e?.message ?? e));
      }
    }
  }
  if (display) lines.push("", ...quoteBlock(display));
  for (const att of msg.attachments) {
    let ext = att.name.includes(".") ? att.name.split(".").pop() : "";
    if (att.kind === "image") ext = ext && ext !== "bin" ? ext : detectImageExt(att.data);
    const base = `${dayStamp(msg.timeMs)}_${timeOfDay(msg.timeMs).replace(":", "")}`;
    const rawPath = `${settings.attachmentFolder}/${base}_${sanitizeFileName(att.name.replace(/\.[^.]+$/, "") || att.kind)}.${ext || "bin"}`;
    const path = await uniquePath(app, rawPath);
    try {
      const ab = att.data.buffer.slice(att.data.byteOffset, att.data.byteOffset + att.data.byteLength);
      await app.vault.adapter.writeBinary(path, ab);
      result.attachmentPaths.push(path);
      const embed = att.kind === "image" ? `![[${path}]]` : `[[${path}|${att.name}]]`;
      lines.push("", ...quoteBlock(embed));
    } catch (e) {
      result.attachmentFailures.push(`${att.name} (${String(e?.message ?? e)})`);
      lines.push("", ...quoteBlock(t("importer.attachFailed", { name: att.name })));
    }
  }
  result.dailyNote = `${settings.inboxFolder}/${dayStamp(msg.timeMs)}.md`;
  result.appended = await appendDaily(app, settings.inboxFolder, msg.timeMs, msg.from, lines);
  return result;
}
function quoteBlock(text) {
  return text.trim().split("\n").map((l) => `> ${l}`);
}
async function appendDaily(app, inboxFolder, timeMs, sender, lines) {
  const dailyPath = `${inboxFolder}/${dayStamp(timeMs)}.md`;
  const block = lines.join("\n") + "\n\n";
  try {
    if (await app.vault.adapter.exists(dailyPath)) {
      await app.vault.adapter.append(dailyPath, block);
    } else {
      const header = `---
date: ${dayStamp(timeMs)}
sender: ${sender}
---

# ${t("importer.inboxTitle", { date: dayStamp(timeMs) })}

`;
      await app.vault.adapter.write(dailyPath, header + block);
    }
    return true;
  } catch {
    return false;
  }
}
async function appendOutbound(app, inboxFolder, timeMs, sender, lines) {
  await appendDaily(app, inboxFolder, timeMs, sender, lines);
}

// src/core/agent-guide.ts
var GUIDE_REV = "2";
function agentGuideMeta(content) {
  const fm = /^---\s*\n([\s\S]*?)\n---/.exec(content)?.[1] ?? "";
  const lang = /lang:\s*"?(\w+)"?/.exec(fm)?.[1] ?? "";
  const paths = /paths:\s*"([^"]*)"/.exec(fm)?.[1] ?? "";
  const rev = /rev:\s*"?(\w+)"?/.exec(fm)?.[1] ?? "";
  return { lang, paths, rev };
}
function pathsKey(s) {
  return [s.inboxFolder, s.outboxFolder, s.attachmentFolder].join("|");
}
function buildEn(s) {
  return `---
lang: en
rev: ${GUIDE_REV}
paths: "${pathsKey(s)}"
---

# WeChat Send (Wechatian)

This Obsidian vault runs the Wechatian plugin, which exposes a one-to-one WeChat channel: every message goes to the vault owner's own bound WeChat account.

## Sending

Write a file into the outbox folder \`${s.outboxFolder}/\`:

- \`.md\` file: the content is sent verbatim as a text message \u2014 **markdown is supported** (headings, lists, bold, code blocks); keep it within a phone screen or so (the file name carries no meaning)
- Image (\`.jpg/.png/.gif/.webp\`), video (\`.mp4\` etc.) or document (\`.pdf/.docx/...\`, \u2264100MB): sent as an attachment

The plugin consumes the outbox on its next poll (~30-60 s). A successful send deletes the file and records the message in today's conversation note under \`${s.inboxFolder}/\` (marked "sent"; media sends keep a copy under \`${s.attachmentFolder}/\` and link it from the note). A failure keeps the file (an \`.md\` gets a \`<!-- Wechatian send failed: ... -->\` comment appended, a media file gets a \`<name>.wechatian-failed.md\` sidecar). After writing, wait about a minute and check whether the file still exists to determine the result.

## Receiving

Inbound WeChat messages are appended to the same daily conversation notes under \`${s.inboxFolder}/\` (marked "received"); media arrives under \`${s.attachmentFolder}/\`.

## Constraints

The gateway rate-limits proactive sends. Use this channel for notifications (task finished, long job done), not for conversation.
`;
}
function buildZh(s) {
  return `---
lang: zh
rev: ${GUIDE_REV}
paths: "${pathsKey(s)}"
---

# \u5FAE\u4FE1\u53D1\u9001(Wechatian)

\u672C vault \u88C5\u4E86 Wechatian \u63D2\u4EF6,\u63D0\u4F9B\u4E00\u6761\u4E00\u5BF9\u4E00\u5FAE\u4FE1\u901A\u9053:\u6240\u6709\u6D88\u606F\u90FD\u53D1\u7ED9 vault \u4E3B\u4EBA\u81EA\u5DF1\u7ED1\u5B9A\u7684\u5FAE\u4FE1\u3002

## \u53D1\u9001

\u5F80\u53D1\u4EF6\u7BB1\u76EE\u5F55 \`${s.outboxFolder}/\` \u5199\u4E00\u4E2A\u6587\u4EF6:

- \`.md\` \u6587\u4EF6:\u5185\u5BB9**\u539F\u6837**\u4F5C\u4E3A\u6587\u672C\u6D88\u606F\u53D1\u9001,**\u652F\u6301 markdown \u683C\u5F0F**(\u6807\u9898\u3001\u5217\u8868\u3001\u52A0\u7C97\u3001\u4EE3\u7801\u5757),\u5EFA\u8BAE\u63A7\u5236\u5728\u624B\u673A\u4E00\u5C4F\u5185(\u6587\u4EF6\u540D\u65E0\u8BED\u4E49)
- \u56FE\u7247(\`.jpg/.png/.gif/.webp\`)\u3001\u89C6\u9891(\`.mp4\` \u7B49)\u6216\u6587\u6863(\`.pdf/.docx/...\`,\u2264100MB):\u4F5C\u4E3A\u9644\u4EF6\u53D1\u9001

\u63D2\u4EF6\u5728\u4E0B\u4E00\u8F6E\u8F6E\u8BE2(\u7EA6 30-60 \u79D2)\u6D88\u8D39\u53D1\u4EF6\u7BB1\u3002\u53D1\u9001\u6210\u529F\u4F1A\u5220\u9664\u6587\u4EF6,\u5E76\u628A\u8FD9\u6761\u6D88\u606F\u8BB0\u5F55\u8FDB \`${s.inboxFolder}/\` \u4E0B\u5F53\u5929\u7684\u5BF9\u8BDD\u7B14\u8BB0(\u6807\u8BB0"\u53D1\u9001";\u5A92\u4F53\u53D1\u9001\u4F1A\u5728 \`${s.attachmentFolder}/\` \u5B58\u4E00\u4EFD\u526F\u672C\u5E76\u5728\u7B14\u8BB0\u91CC\u94FE\u63A5)\u3002\u5931\u8D25\u4F1A\u4FDD\u7559\u6587\u4EF6(\`.md\` \u672B\u5C3E\u8FFD\u52A0 \`<!-- Wechatian send failed: ... -->\` \u6CE8\u91CA,\u5A92\u4F53\u6587\u4EF6\u751F\u6210 \`<\u6587\u4EF6\u540D>.wechatian-failed.md\` \u8BB0\u5F55)\u3002\u5199\u5165\u540E\u7B49\u7EA6\u4E00\u5206\u949F,\u68C0\u67E5\u6587\u4EF6\u662F\u5426\u8FD8\u5728\u4EE5\u5224\u65AD\u7ED3\u679C\u3002

## \u63A5\u6536

\u6536\u5230\u7684\u5FAE\u4FE1\u6D88\u606F\u8FFD\u52A0\u5230\u540C\u4E00\u4EFD\u6BCF\u65E5\u5BF9\u8BDD\u7B14\u8BB0 \`${s.inboxFolder}/\`(\u6807\u8BB0"\u63A5\u6536"),\u5A92\u4F53\u9644\u4EF6\u4FDD\u5B58\u5728 \`${s.attachmentFolder}/\`\u3002

## \u9650\u5236

\u7F51\u5173\u5BF9\u4E3B\u52A8\u6D88\u606F\u6709\u9650\u6D41\u3002\u7528\u4E8E\u901A\u77E5(\u4EFB\u52A1\u5B8C\u6210\u3001\u957F\u4EFB\u52A1\u7ED3\u675F),\u4E0D\u8981\u5F53\u804A\u5929\u901A\u9053\u3002
`;
}
function buildTw(s) {
  return `---
lang: tw
rev: ${GUIDE_REV}
paths: "${pathsKey(s)}"
---

# \u5FAE\u4FE1\u767C\u9001(Wechatian)

\u672C vault \u88DD\u4E86 Wechatian \u5916\u639B,\u63D0\u4F9B\u4E00\u689D\u4E00\u5C0D\u4E00\u5FAE\u4FE1\u901A\u9053:\u6240\u6709\u8A0A\u606F\u90FD\u767C\u7D66 vault \u4E3B\u4EBA\u81EA\u5DF1\u7D81\u5B9A\u7684\u5FAE\u4FE1\u3002

## \u767C\u9001

\u5F80\u767C\u4EF6\u5323\u76EE\u9304 \`${s.outboxFolder}/\` \u5BEB\u4E00\u500B\u6A94\u6848:

- \`.md\` \u6A94\u6848:\u5167\u5BB9**\u539F\u6A23**\u4F5C\u70BA\u6587\u5B57\u8A0A\u606F\u767C\u9001,**\u652F\u63F4 markdown \u683C\u5F0F**(\u6A19\u984C\u3001\u5217\u8868\u3001\u52A0\u7C97\u3001\u7A0B\u5F0F\u78BC\u5340\u584A),\u5EFA\u8B70\u63A7\u5236\u5728\u624B\u6A5F\u4E00\u5C4F\u5167(\u6A94\u540D\u7121\u8A9E\u7FA9)
- \u5716\u7247(\`.jpg/.png/.gif/.webp\`)\u3001\u5F71\u7247(\`.mp4\` \u7B49)\u6216\u6587\u4EF6(\`.pdf/.docx/...\`,\u2264100MB):\u4F5C\u70BA\u9644\u4EF6\u767C\u9001

\u5916\u639B\u5728\u4E0B\u4E00\u8F2A\u8F2A\u8A62(\u7D04 30-60 \u79D2)\u6D88\u8CBB\u767C\u4EF6\u5323\u3002\u767C\u9001\u6210\u529F\u6703\u522A\u9664\u6A94\u6848,\u4E26\u628A\u9019\u689D\u8A0A\u606F\u8A18\u9304\u9032 \`${s.inboxFolder}/\` \u4E0B\u7576\u5929\u7684\u5C0D\u8A71\u7B46\u8A18(\u6A19\u8A18"\u767C\u9001";\u5A92\u9AD4\u767C\u9001\u6703\u5728 \`${s.attachmentFolder}/\` \u5B58\u4E00\u4EFD\u526F\u672C\u4E26\u5728\u7B46\u8A18\u88E1\u9023\u7D50)\u3002\u5931\u6557\u6703\u4FDD\u7559\u6A94\u6848(\`.md\` \u672B\u5C3E\u8FFD\u52A0 \`<!-- Wechatian send failed: ... -->\` \u8A3B\u89E3,\u5A92\u9AD4\u6A94\u6848\u7522\u751F \`<\u6A94\u540D>.wechatian-failed.md\` \u8A18\u9304)\u3002\u5BEB\u5165\u5F8C\u7B49\u7D04\u4E00\u5206\u9418,\u6AA2\u67E5\u6A94\u6848\u662F\u5426\u9084\u5728\u4EE5\u5224\u65B7\u7D50\u679C\u3002

## \u63A5\u6536

\u6536\u5230\u7684\u5FAE\u4FE1\u8A0A\u606F\u9644\u52A0\u5230\u540C\u4E00\u4EFD\u6BCF\u65E5\u5C0D\u8A71\u7B46\u8A18 \`${s.inboxFolder}/\`(\u6A19\u8A18"\u63A5\u6536"),\u5A92\u9AD4\u9644\u4EF6\u5132\u5B58\u5728 \`${s.attachmentFolder}/\`\u3002

## \u9650\u5236

\u9598\u9053\u5668\u5C0D\u4E3B\u52D5\u8A0A\u606F\u6709\u9650\u6D41\u3002\u7528\u65BC\u901A\u77E5(\u4EFB\u52D9\u5B8C\u6210\u3001\u9577\u4EFB\u52D9\u7D50\u675F),\u4E0D\u8981\u7576\u804A\u5929\u901A\u9053\u3002
`;
}
async function ensureAgentGuide(app, s, lang) {
  const path = `${s.inboxFolder}/Agent.md`;
  const target = lang === "zh" ? buildZh(s) : lang === "tw" ? buildTw(s) : buildEn(s);
  try {
    if (await app.vault.adapter.exists(path)) {
      const cur = agentGuideMeta(await app.vault.adapter.read(path));
      if (cur.lang === lang && cur.rev === GUIDE_REV && cur.paths === pathsKey(s)) return;
    } else {
      await ensureFolder(app, s.inboxFolder);
    }
    await app.vault.adapter.write(path, target);
  } catch {
  }
}

// src/settings.ts
var import_obsidian4 = require("obsidian");

// src/core/qrlogin.ts
var QR_POLL_TIMEOUT = 35e3;
var QR_PROACTIVE_REFRESH_AT = 8e4;
var MAX_REFRESH = 3;
async function fetchBotQrCode(transport, apiBase) {
  const u = `${apiBase.replace(/\/$/, "")}/ilink/bot/get_bot_qrcode?bot_type=3`;
  const resp = await transport.get(u, {}, 2e4);
  if (resp.status !== 200) throw new Error(`get_bot_qrcode http ${resp.status}`);
  const out = bodyJson(resp);
  if (!out.qrcode || !out.qrcode_img_content) {
    throw new Error(t("qr.missingInResponse", { resp: JSON.stringify(out).slice(0, 200) }));
  }
  return out;
}
async function pollQrStatus(transport, apiBase, qrKey) {
  const u = `${apiBase.replace(/\/$/, "")}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrKey)}`;
  try {
    const resp = await transport.get(u, { "iLink-App-ClientVersion": "1" }, QR_POLL_TIMEOUT + 5e3);
    if (resp.status !== 200) throw new Error(`get_qrcode_status http ${resp.status}`);
    return bodyJson(resp);
  } catch (e) {
    if (e.timeout) return { status: "wait" };
    throw e;
  }
}
async function loginLoop(transport, apiBase, cb, timeoutMs = 48e4) {
  const deadline = Date.now() + timeoutMs;
  const fetchQr = async () => {
    const qr = await fetchBotQrCode(transport, apiBase);
    const url = qr.qrcode_img_content.trim();
    cb.onQr(url);
    return { qrKey: qr.qrcode, qrUrl: url };
  };
  let cur = await fetchQr();
  let fetchedAt = Date.now();
  let refreshCount = 1;
  let scannedPrinted = false;
  while (Date.now() < deadline) {
    if (cb.cancelled()) return null;
    if (Date.now() - fetchedAt > QR_PROACTIVE_REFRESH_AT && refreshCount < MAX_REFRESH) {
      refreshCount++;
      try {
        cur = await fetchQr();
        fetchedAt = Date.now();
        scannedPrinted = false;
      } catch (e) {
        cb.onError(t("qr.refreshFailed", { err: String(e?.message ?? e) }));
        await sleep3(1e3);
        continue;
      }
    }
    let st;
    try {
      st = await pollQrStatus(transport, apiBase, cur.qrKey);
    } catch (e) {
      cb.onError(t("qr.queryFailed", { err: String(e?.message ?? e) }));
      await sleep3(1e3);
      continue;
    }
    if (cb.cancelled()) return null;
    switch (st.status) {
      case "wait":
      case "":
        await sleep3(200);
        break;
      case "scaned":
        if (!scannedPrinted) {
          scannedPrinted = true;
          cb.onScanned();
        }
        await sleep3(300);
        break;
      case "expired": {
        refreshCount++;
        if (refreshCount > MAX_REFRESH) {
          cb.onError(t("qr.expiredMultiple"));
          return null;
        }
        try {
          cur = await fetchQr();
          fetchedAt = Date.now();
          scannedPrinted = false;
        } catch (e) {
          cb.onError(t("qr.refreshFailed", { err: String(e?.message ?? e) }));
          await sleep3(1e3);
        }
        break;
      }
      case "confirmed": {
        const botId = (st.ilink_bot_id ?? "").trim();
        const token = (st.bot_token ?? "").trim();
        if (!botId || !token) {
          cb.onError(t("qr.confirmMissingCreds"));
          return null;
        }
        return {
          token,
          botId,
          baseUrl: (st.baseurl ?? "").trim(),
          scannedUser: (st.ilink_user_id ?? "").trim()
        };
      }
      default:
        await sleep3(500);
    }
  }
  cb.onError(t("qr.timeout"));
  return null;
}
function sleep3(ms) {
  return new Promise((r) => window.setTimeout(r, ms));
}

// src/core/qrcode.ts
var DATA_CODEWORDS_M = [0, 16, 28, 44, 64, 86, 108, 124, 154, 182, 216];
var ECC_LEN_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
var RS_BLOCKS_M = [
  [],
  [[1, 16]],
  [[1, 28]],
  [[1, 44]],
  [[2, 32]],
  [[2, 43]],
  [[4, 27]],
  [[4, 31]],
  [[2, 38], [2, 39]],
  [[3, 36], [2, 37]],
  [[4, 43], [1, 44]]
];
var ALIGN = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
var EXP = new Uint8Array(512);
var LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 285;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
function gfMul(a, b) {
  return a && b ? EXP[LOG[a] + LOG[b]] : 0;
}
function polyMul(a, b) {
  const r = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      r[i + j] ^= gfMul(a[i], b[j]);
    }
  }
  return r;
}
function rsGenPoly(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) poly = polyMul(poly, [1, EXP[i]]);
  return poly;
}
function rsEncode(data, eccLen) {
  const gen = rsGenPoly(eccLen);
  const msg = new Array(data.length + eccLen).fill(0);
  for (let i = 0; i < data.length; i++) msg[i] = data[i];
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) msg[i + j] ^= gfMul(gen[j], coef);
    }
  }
  return msg.slice(data.length);
}
function pickVersion(byteLen) {
  for (let v = 1; v <= 10; v++) {
    const headerBits = 4 + (v < 10 ? 8 : 16);
    if (headerBits + byteLen * 8 <= DATA_CODEWORDS_M[v] * 8) return v;
  }
  throw new Error("QR content too long (>213 bytes)");
}
function buildCodewords(data, version) {
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push(value >> i & 1);
  };
  push(4, 4);
  push(data.length, version < 10 ? 8 : 16);
  for (const b of data) push(b, 8);
  const capacity = DATA_CODEWORDS_M[version] * 8;
  for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = b << 1 | bits[i + j];
    codewords.push(b);
  }
  const pads = [236, 17];
  for (let i = 0; codewords.length < DATA_CODEWORDS_M[version]; i++) {
    codewords.push(pads[i % 2]);
  }
  return codewords;
}
function interleave(codewords, version) {
  const blocks = RS_BLOCKS_M[version];
  const eccLen = ECC_LEN_M[version];
  const dataBlocks = [];
  const eccBlocks = [];
  let offset = 0;
  for (const [count, perBlock] of blocks) {
    for (let i = 0; i < count; i++) {
      const data = codewords.slice(offset, offset + perBlock);
      offset += perBlock;
      dataBlocks.push(data);
      eccBlocks.push(rsEncode(data, eccLen));
    }
  }
  const out = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const b of dataBlocks) if (i < b.length) out.push(b[i]);
  }
  for (let i = 0; i < eccLen; i++) {
    for (const b of eccBlocks) out.push(b[i]);
  }
  return out;
}
var MASK_FNS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => r * c % 2 + r * c % 3 === 0,
  (r, c) => (r * c % 2 + r * c % 3) % 2 === 0,
  (r, c) => ((r + c) % 2 + r * c % 3) % 2 === 0
];
function bch15(data5) {
  let v = data5 << 10;
  for (let i = 14; i >= 10; i--) {
    if (v & 1 << i) v ^= 1335 << i - 10;
  }
  return (data5 << 10 | v) ^ 21522;
}
function bch18(v6) {
  let v = v6 << 12;
  for (let i = 17; i >= 12; i--) {
    if (v & 1 << i) v ^= 7973 << i - 12;
  }
  return v6 << 12 | v;
}
var Matrix = class {
  size;
  m;
  // -1 = unset
  func;
  // 1 = function area
  constructor(version) {
    this.size = version * 4 + 17;
    this.m = new Int8Array(this.size * this.size).fill(-1);
    this.func = new Uint8Array(this.size * this.size);
  }
  idx(r, c) {
    return r * this.size + c;
  }
  set(r, c, v, isFunc = true) {
    this.m[this.idx(r, c)] = v;
    if (isFunc) this.func[this.idx(r, c)] = 1;
  }
  setupPatterns(version) {
    const n = this.size;
    const finder = (r0, c0) => {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const rr = r0 + r;
          const cc = c0 + c;
          if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
          const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6;
          const dark = inRing && (r === 0 || r === 6 || c === 0 || c === 6 || r >= 2 && r <= 4 && c >= 2 && c <= 4);
          this.set(rr, cc, dark ? 1 : 0);
        }
      }
    };
    finder(0, 0);
    finder(n - 7, 0);
    finder(0, n - 7);
    for (let i = 8; i < n - 8; i++) {
      this.set(6, i, i % 2 === 0 ? 1 : 0);
      this.set(i, 6, i % 2 === 0 ? 1 : 0);
    }
    const pos = ALIGN[version];
    for (const r of pos) {
      for (const c of pos) {
        if (this.func[this.idx(r, c)]) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            this.set(r + dr, c + dc, dark ? 1 : 0);
          }
        }
      }
    }
    for (let i = 0; i < 9; i++) {
      if (this.m[this.idx(8, i)] === -1) this.set(8, i, 0);
      if (this.m[this.idx(i, 8)] === -1) this.set(i, 8, 0);
    }
    for (let i = 0; i < 8; i++) {
      this.set(8, n - 1 - i, 0);
      this.set(n - 1 - i, 8, 0);
    }
    this.set(n - 8, 8, 1);
    if (version >= 7) {
      for (let i = 0; i < 18; i++) {
        const r = Math.floor(i / 3);
        const c = i % 3 + n - 11;
        this.set(r, c, 0);
        this.set(c, r, 0);
      }
    }
  }
  placeData(bits) {
    const n = this.size;
    let bitIdx = 0;
    let upward = true;
    for (let col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (let i = 0; i < n; i++) {
        const row = upward ? n - 1 - i : i;
        for (let k = 0; k < 2; k++) {
          const cc = col - k;
          const id = this.idx(row, cc);
          if (this.func[id]) continue;
          this.m[id] = bitIdx < bits.length ? bits[bitIdx] : 0;
          bitIdx++;
        }
      }
      upward = !upward;
    }
  }
  applyMask(mask) {
    const fn = MASK_FNS[mask];
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const id = this.idx(r, c);
        if (!this.func[id] && fn(r, c)) this.m[id] ^= 1;
      }
    }
  }
  placeFormat(mask) {
    const n = this.size;
    const fmt = bch15(0 << 3 | mask);
    for (let i = 0; i < 15; i++) {
      const bit = fmt >> i & 1;
      if (i < 6) this.set(i, 8, bit);
      else if (i === 6) this.set(7, 8, bit);
      else if (i === 7) this.set(8, 8, bit);
      else if (i === 8) this.set(8, 7, bit);
      else this.set(8, 14 - i, bit);
      if (i < 8) this.set(8, n - 1 - i, bit);
      else this.set(n - 15 + i, 8, bit);
    }
  }
  placeVersion(version) {
    if (version < 7) return;
    const n = this.size;
    const v = bch18(version);
    for (let i = 0; i < 18; i++) {
      const bit = v >> i & 1;
      const r = Math.floor(i / 3);
      const c = i % 3 + n - 11;
      this.set(r, c, bit);
      this.set(c, r, bit);
    }
  }
  penalty() {
    const n = this.size;
    const at = (r, c) => this.m[this.idx(r, c)];
    let score = 0;
    for (let r = 0; r < n; r++) {
      let run = 1;
      for (let c = 1; c <= n; c++) {
        if (c < n && at(r, c) === at(r, c - 1)) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
    }
    for (let c = 0; c < n; c++) {
      let run = 1;
      for (let r = 1; r <= n; r++) {
        if (r < n && at(r, c) === at(r - 1, c)) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
    }
    for (let r = 0; r < n - 1; r++) {
      for (let c = 0; c < n - 1; c++) {
        const v = at(r, c);
        if (at(r, c + 1) === v && at(r + 1, c) === v && at(r + 1, c + 1) === v) score += 3;
      }
    }
    const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const matchPat = (get, len) => {
      for (let i = 0; i + 11 <= len; i++) {
        let m1 = true;
        let m2 = true;
        for (let j = 0; j < 11; j++) {
          const v = get(i + j);
          if (v !== pat1[j]) m1 = false;
          if (v !== pat2[j]) m2 = false;
          if (!m1 && !m2) break;
        }
        if (m1 || m2) score += 40;
      }
    };
    for (let r = 0; r < n; r++) matchPat((i) => at(r, i), n);
    for (let c = 0; c < n; c++) matchPat((i) => at(i, c), n);
    let dark = 0;
    for (let i = 0; i < n * n; i++) if (this.m[i] === 1) dark++;
    const pct = dark * 100 / (n * n);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }
  cloneFrom(other) {
    this.m.set(other.m);
    this.func.set(other.func);
  }
};
function encodeQr(text) {
  const data = new TextEncoder().encode(text);
  const version = pickVersion(data.length);
  const codewords = interleave(buildCodewords(data, version), version);
  const bits = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i--) bits.push(cw >> i & 1);
  }
  const base = new Matrix(version);
  base.setupPatterns(version);
  base.placeData(bits);
  base.placeVersion(version);
  let bestMask = 0;
  let bestScore = Infinity;
  const trial = new Matrix(version);
  for (let mask = 0; mask < 8; mask++) {
    trial.cloneFrom(base);
    trial.applyMask(mask);
    trial.placeFormat(mask);
    const s = trial.penalty();
    if (s < bestScore) {
      bestScore = s;
      bestMask = mask;
    }
  }
  base.applyMask(bestMask);
  base.placeFormat(bestMask);
  const size = base.size;
  return {
    size,
    isDark: (r, c) => base.m[r * size + c] === 1
  };
}

// src/settings.ts
var DEFAULT_SETTINGS = {
  language: "system",
  enabled: true,
  inboxFolder: "Wechatian",
  attachmentFolder: "Wechatian/attachments",
  articleFolder: "Wechatian/articles",
  outboxFolder: "Wechatian/outbox",
  fetchArticles: true,
  groupArticlesByAccount: true,
  autoImport: true,
  notifyOnMessage: true,
  autoReply: true
};
var FOLDER_KEYS = ["inboxFolder", "attachmentFolder", "articleFolder", "outboxFolder"];
var WechatianSettingTab = class extends import_obsidian4.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  /** Liveness flag for the settings pane: aborts QR polling when switched away/closed */
  alive = false;
  hide() {
    this.alive = false;
  }
  getControlValue(key) {
    return this.plugin.settings[key];
  }
  setControlValue(key, value) {
    this.plugin.settings[key] = value;
    if (key === "language") {
      this.plugin.applyLanguage(value);
      this.update();
    }
    if (FOLDER_KEYS.includes(key)) this.plugin.refreshAgentGuide();
    void this.plugin.saveSettings();
  }
  getSettingDefinitions() {
    return [
      {
        name: t("set.autoConnect"),
        desc: t("set.autoConnect.desc"),
        control: { type: "toggle", key: "enabled", defaultValue: DEFAULT_SETTINGS.enabled }
      },
      {
        name: t("set.language"),
        desc: t("set.language.desc"),
        control: {
          type: "dropdown",
          key: "language",
          defaultValue: DEFAULT_SETTINGS.language,
          options: { system: t("set.language.system"), en: "English", zh: "\u4E2D\u6587\uFF08\u7B80\u4F53\uFF09", tw: "\u4E2D\u6587\uFF08\u7E41\u9AD4\uFF09" }
        }
      },
      // Login section: dynamic QR flow, rendered imperatively via the escape hatch
      { name: t("login.status"), render: (setting) => this.renderLoginSection(setting.settingEl) },
      {
        name: t("set.inboxFolder"),
        desc: t("set.inboxFolder.desc"),
        control: { type: "text", key: "inboxFolder", defaultValue: DEFAULT_SETTINGS.inboxFolder }
      },
      {
        name: t("set.attachmentFolder"),
        desc: t("set.attachmentFolder.desc"),
        control: { type: "text", key: "attachmentFolder", defaultValue: DEFAULT_SETTINGS.attachmentFolder }
      },
      {
        name: t("set.articleFolder"),
        desc: t("set.articleFolder.desc"),
        control: { type: "text", key: "articleFolder", defaultValue: DEFAULT_SETTINGS.articleFolder }
      },
      {
        name: t("set.outboxFolder"),
        desc: t("set.outboxFolder.desc"),
        control: { type: "text", key: "outboxFolder", defaultValue: DEFAULT_SETTINGS.outboxFolder }
      },
      {
        name: t("set.autoImport"),
        desc: t("set.autoImport.desc"),
        control: { type: "toggle", key: "autoImport", defaultValue: DEFAULT_SETTINGS.autoImport }
      },
      {
        name: t("set.fetchArticles"),
        desc: t("set.fetchArticles.desc"),
        control: { type: "toggle", key: "fetchArticles", defaultValue: DEFAULT_SETTINGS.fetchArticles }
      },
      {
        name: t("set.groupByAccount"),
        desc: t("set.groupByAccount.desc"),
        control: {
          type: "toggle",
          key: "groupArticlesByAccount",
          defaultValue: DEFAULT_SETTINGS.groupArticlesByAccount
        }
      },
      {
        name: t("set.notify"),
        control: { type: "toggle", key: "notifyOnMessage", defaultValue: DEFAULT_SETTINGS.notifyOnMessage }
      },
      {
        name: t("set.autoReply"),
        desc: t("set.autoReply.desc"),
        control: { type: "toggle", key: "autoReply", defaultValue: DEFAULT_SETTINGS.autoReply }
      },
      {
        name: "",
        searchable: false,
        render: (setting) => {
          setting.settingEl.createEl("p", { text: t("set.footer"), cls: "setting-item-description" });
        }
      },
      // Where agents learn the outbox protocol: a note file maintained inside the vault
      {
        name: t("set.agentGuide"),
        desc: t("set.agentGuide.desc", { path: `${this.plugin.settings.inboxFolder}/Agent.md` })
      }
    ];
  }
  /** Login-status section: shows the bound ID when logged in; inline QR code otherwise */
  renderLoginSection(containerEl) {
    this.alive = true;
    containerEl.empty();
    const st = this.plugin.getState();
    const section = containerEl.createDiv({ cls: "wechatian-login-section" });
    if (st?.token) {
      new import_obsidian4.Setting(section).setName(t("login.status")).setDesc(t("login.bound", { bot: st.botId || "?", user: st.scannedUser || "?" })).addButton(
        (b) => b.setButtonText(t("login.rescan")).onClick(() => {
          void this.startInlineLogin(section);
        })
      ).addButton(
        (b) => b.setButtonText(t("login.logout")).setDestructive().onClick(async () => {
          this.plugin.disconnect();
          this.plugin.clearCredentials();
          new import_obsidian4.Notice(t("notice.loggedOut"));
          this.update();
        })
      );
      let testInput = null;
      new import_obsidian4.Setting(section).setName(t("sendTest.name")).setDesc(t("sendTest.desc")).addText((txt) => {
        txt.setPlaceholder(t("sendTest.placeholder")).setValue("Hello from wechatian");
        txt.inputEl.addClass("wechatian-send-input");
        testInput = txt;
      }).addButton((b) => {
        b.setButtonText(t("sendTest.send")).setCta();
        b.onClick(async () => {
          const text = (testInput?.getValue() ?? "").trim();
          if (!text) {
            new import_obsidian4.Notice(t("sendTest.empty"));
            return;
          }
          b.setDisabled(true);
          const res = await this.plugin.sendTestMessage(text);
          b.setDisabled(false);
          if (res.ok) {
            new import_obsidian4.Notice(t("sendTest.ok"));
          } else {
            new import_obsidian4.Notice(t("sendTest.failed", { err: buildSendFailure(res.errmsg, res.ret) }), 1e4);
          }
        });
      });
    } else {
      section.createEl("p", { text: t("login.notLoggedIn") });
      void this.startInlineLogin(section);
    }
  }
  /** Inline scan inside the settings page: render QR -> poll -> refresh the pane on success */
  async startInlineLogin(section) {
    section.empty();
    const qrWrap = section.createDiv({ cls: "wechatian-qr" });
    const statusEl = section.createEl("p", { text: t("login.fetching"), cls: "wechatian-qr-status" });
    const out = await loginLoop(this.plugin.getTransport(), this.plugin.getApiBase(), {
      onQr: (url) => {
        if (!this.alive) return;
        this.renderQrInto(qrWrap, url);
        statusEl.setText(t("login.waiting"));
      },
      onScanned: () => {
        if (this.alive) statusEl.setText(t("login.scanned"));
      },
      onError: (msg) => {
        if (this.alive) statusEl.setText(msg);
      },
      cancelled: () => !this.alive
    });
    if (!this.alive) return;
    if (out) {
      this.plugin.applyLogin(out);
      new import_obsidian4.Notice(t("notice.loggedIn"));
      this.update();
    }
  }
  /** Render the QR code into the given container (canvas + URL fallback text) */
  renderQrInto(el, url) {
    el.empty();
    try {
      const qr = encodeQr(url);
      const n = qr.size + 8;
      const cell = Math.max(3, Math.min(8, Math.floor(240 / n)));
      const canvas = el.createEl("canvas");
      canvas.width = n * cell;
      canvas.height = n * cell;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#000000";
      const quiet = 4;
      for (let r = 0; r < qr.size; r++) {
        for (let c = 0; c < qr.size; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
          }
        }
      }
    } catch {
      el.createDiv({ text: url });
    }
    el.createDiv({ text: url, cls: "wechatian-qr-url" });
  }
};

// src/qr-modal.ts
var import_obsidian5 = require("obsidian");
var QrLoginModal = class extends import_obsidian5.Modal {
  constructor(app, transport, baseUrl, onDone) {
    super(app);
    this.transport = transport;
    this.baseUrl = baseUrl;
    this.onDone = onDone;
  }
  cancelled = false;
  qrEl = null;
  statusEl = null;
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t("modal.title") });
    contentEl.createEl("p", { text: t("modal.hint"), cls: "wechatian-qr-hint" });
    this.qrEl = contentEl.createDiv({ cls: "wechatian-qr wechatian-qr-center" });
    this.statusEl = contentEl.createEl("p", { text: t("login.fetching"), cls: "wechatian-qr-status" });
    void loginLoop(this.transport, this.baseUrl, {
      onQr: (url) => {
        this.renderQr(url);
        this.setStatus(t("login.waiting"));
      },
      onScanned: () => this.setStatus(t("login.scanned")),
      onError: (msg) => this.setStatus(msg),
      cancelled: () => this.cancelled
    }).then((out) => {
      if (!out || this.cancelled) return;
      this.setStatus(t("login.success"));
      this.close();
      this.onDone(out);
    }).catch((e) => {
      this.setStatus(String(e?.message ?? e));
    });
  }
  renderQr(url) {
    if (!this.qrEl) return;
    this.qrEl.empty();
    try {
      const qr = encodeQr(url);
      const cell = 6;
      const quiet = 4;
      const n = qr.size + quiet * 2;
      const canvas = this.qrEl.createEl("canvas", { cls: "wechatian-qr-canvas" });
      canvas.width = n * cell;
      canvas.height = n * cell;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#000000";
      for (let r = 0; r < qr.size; r++) {
        for (let c = 0; c < qr.size; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
          }
        }
      }
      this.qrEl.createEl("a", { text: t("modal.openLink"), href: url, cls: "wechatian-qr-link" });
    } catch (e) {
      this.qrEl.createEl("p", { text: t("modal.renderFailed", { err: String(e?.message ?? e) }) });
    }
  }
  setStatus(text) {
    if (this.statusEl) this.statusEl.setText(text);
  }
  onClose() {
    this.cancelled = true;
    this.contentEl.empty();
  }
};

// src/outbox.ts
var IMAGE_EXTS = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);
var Outbox = class {
  constructor(app) {
    this.app = app;
  }
  /**
   * Scan and process all pending-send files; returns the processed count.
   * This is a one-to-one channel: every file is delivered to the account that
   * scanned to bind the bot (the owner), so the file name carries no recipient.
   * .md files are sent as text; images/videos/other binaries go through the CDN.
   * Successful sends delete the outbox file and are recorded in the daily
   * conversation note; media sends also keep a copy in the attachment folder.
   */
  async flush(client, store, folder, inboxFolder, attachmentFolder) {
    if (!folder || !await this.app.vault.adapter.exists(folder)) return 0;
    const st = store.get();
    const to = st.scannedUser.trim();
    if (!to) return 0;
    const contextToken = st.contextTokens[to] ?? "";
    const listing = await this.app.vault.adapter.list(folder);
    let processed = 0;
    for (const path of listing.files) {
      const name = path.split("/").pop() ?? "";
      const ext = (name.includes(".") ? name.split(".").pop() ?? "" : "").toLowerCase();
      if (name.endsWith(".wechatian-failed.md")) continue;
      if (ext === "md") {
        processed += await this.flushTextFile(client, path, to, contextToken, inboxFolder);
        continue;
      }
      if (IMAGE_EXTS.has(ext) || isVideoExt(ext) || BINARY_EXTS.has(ext)) {
        processed += await this.flushMediaFile(client, path, name, to, contextToken, inboxFolder, attachmentFolder);
      }
    }
    return processed;
  }
  /** .md -> send the content as a text message */
  async flushTextFile(client, path, to, contextToken, inboxFolder) {
    const content = (await this.app.vault.adapter.read(path)).trim();
    if (!content) {
      await this.app.vault.adapter.remove(path);
      return 0;
    }
    const res = await client.sendText(to, content, contextToken);
    if (res.ok) {
      const now = Date.now();
      await appendOutbound(this.app, inboxFolder, now, to, [
        `**${timeOfDay(now)}** \xB7 ${t("importer.sent")}`,
        "",
        ...quoteBlock(content)
      ]);
      await this.app.vault.adapter.remove(path);
      return 1;
    }
    const note = `

<!-- Wechatian send failed: ${buildSendFailure(res.errmsg, res.ret, contextToken)} -->
`;
    await this.app.vault.adapter.write(path, content + note);
    return 0;
  }
  /** image/video/file -> AES-ECB encrypt, upload to CDN, send as a media message */
  async flushMediaFile(client, path, name, to, contextToken, inboxFolder, attachmentFolder) {
    const ext = (name.includes(".") ? name.split(".").pop() ?? "" : "").toLowerCase();
    const kind = IMAGE_EXTS.has(ext) ? "image" : isVideoExt(ext) ? "video" : "file";
    let data;
    try {
      data = new Uint8Array(await this.app.vault.adapter.readBinary(path));
    } catch {
      return 0;
    }
    const res = await client.sendMedia(to, { kind, name, data }, contextToken);
    if (res.ok) {
      const now = Date.now();
      const copyPath = await this.uniqueCopyPath(
        `${attachmentFolder}/${dayStamp(now)}_${timeOfDay(now).replace(":", "")}_sent_${sanitizeFileName(name)}`
      );
      let linkLine = name;
      try {
        await ensureFolder(this.app, attachmentFolder);
        const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        await this.app.vault.adapter.writeBinary(copyPath, ab);
        linkLine = kind === "image" ? `![[${copyPath}]]` : `[[${copyPath}|${name}]]`;
      } catch {
      }
      await appendOutbound(this.app, inboxFolder, now, to, [
        `**${timeOfDay(now)}** \xB7 ${t("importer.sent")}`,
        "",
        ...quoteBlock(linkLine)
      ]);
      await this.app.vault.adapter.remove(path);
      return 1;
    }
    const notePath = `${path}.wechatian-failed.md`;
    const note = `# ${name}

${buildSendFailure(res.errmsg, res.ret, contextToken)}
`;
    try {
      await this.app.vault.adapter.write(notePath, note);
    } catch {
    }
    return 0;
  }
  /** _1 / _2 / ... before the extension when the copy target already exists */
  async uniqueCopyPath(path) {
    if (!await this.app.vault.adapter.exists(path)) return path;
    const dot = path.lastIndexOf(".");
    const stem = dot > 0 ? path.slice(0, dot) : path;
    const ext = dot > 0 ? path.slice(dot) : "";
    for (let i = 1; ; i++) {
      const candidate = `${stem}_${i}${ext}`;
      if (!await this.app.vault.adapter.exists(candidate)) return candidate;
    }
  }
};
var BINARY_EXTS = /* @__PURE__ */ new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "csv",
  "txt",
  "zip",
  "tar",
  "gz",
  "mp3",
  "amr",
  "wav",
  "silk",
  "m4a"
]);

// src/core/constants.ts
var ILINK_DEFAULT_BASE = "https://ilinkai.weixin.qq.com";
var CDN_BASE = "https://novac2c.cdn.weixin.qq.com/c2c";

// src/main.ts
var LEGACY_STATE_FILE = ".wechatian-plugin/state.json";
var TICKET_TTL_MS = 24 * 36e5;
var WechatianPlugin = class extends import_obsidian6.Plugin {
  settings = DEFAULT_SETTINGS;
  store;
  client = null;
  transport = new ObsidianTransport();
  /** article/image fetches run on Node's http stack: requestUrl's IPC channel has no
   *  timeout/cancel and can wedge the app on misbehaving hosts (issue #1) */
  articleTransport = new NodeTransport();
  polling = false;
  stopRequested = false;
  connState = "disconnected";
  statusBar = null;
  outbox = null;
  statusListeners = /* @__PURE__ */ new Set();
  /** command id -> i18n key, so names can be re-rendered when the language changes */
  commandNameKeys = {};
  async onload() {
    await this.loadSettings();
    applyLanguage(this.settings.language);
    const stateDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    this.store = new StateStore(this.app, `${stateDir}/state.json`, LEGACY_STATE_FILE);
    await this.store.init();
    this.outbox = new Outbox(this.app);
    await this.ensureFolders();
    this.statusBar = this.addStatusBarItem();
    this.renderStatus();
    const cmds = [
      ["wechatian-connect", "cmd.connect", () => void this.connect()],
      ["wechatian-disconnect", "cmd.disconnect", () => this.disconnect()],
      ["wechatian-login", "cmd.login", () => this.startLogin()],
      ["wechatian-open-inbox", "cmd.inbox", () => void this.openTodayInbox()]
    ];
    for (const [id, key, callback] of cmds) {
      this.commandNameKeys[id] = key;
      this.addCommand({ id, name: t(key), callback });
    }
    this.addSettingTab(new WechatianSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.enabled && this.store.get().token) {
        void this.startPollLoop();
      } else if (this.settings.enabled) {
        this.setConn("disconnected");
        new import_obsidian6.Notice(t("notice.notLoggedIn", { cmd: t("cmd.login") }));
      }
    });
  }
  onunload() {
    this.disconnect();
  }
  async loadSettings() {
    const raw = await this.loadData();
    if (raw && typeof raw === "object") {
      delete raw.allowFrom;
      delete raw.sentFolder;
    }
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  /** Switch the UI language at runtime (commands, status bar; the settings page re-renders itself) */
  applyLanguage(lang) {
    applyLanguage(lang);
    const registry = this.app.commands;
    for (const [id, key] of Object.entries(this.commandNameKeys)) {
      const cmd = registry?.findCommand(id);
      if (cmd) cmd.name = t(key);
    }
    this.renderStatus();
    void ensureAgentGuide(this.app, this.settings, resolvedLanguage());
  }
  /** Create the whole Wechat directory tree + Agent.md once the plugin is enabled */
  async ensureFolders() {
    const s = this.settings;
    for (const folder of [s.inboxFolder, s.attachmentFolder, s.articleFolder, s.outboxFolder]) {
      try {
        await ensureFolder(this.app, folder);
      } catch {
      }
    }
    await ensureAgentGuide(this.app, s, resolvedLanguage());
  }
  /** Directory settings changed: re-sync Agent.md with the new paths */
  refreshAgentGuide() {
    void ensureAgentGuide(this.app, this.settings, resolvedLanguage());
  }
  /** Status-bar rendering */
  renderStatus() {
    if (!this.statusBar) return;
    const map = {
      disconnected: t("status.disconnected"),
      connecting: t("status.connecting"),
      connected: t("status.connected"),
      expired: t("status.expired"),
      error: t("status.error")
    };
    this.statusBar.setText(`Wechatian ${map[this.connState]}`);
    this.statusBar.setAttribute("aria-label", this.store.get().lastError || "");
  }
  setConn(s) {
    this.connState = s;
    this.renderStatus();
    for (const fn of this.statusListeners) {
      try {
        fn();
      } catch {
      }
    }
  }
  /** Subscribe to connection-state changes (used by the settings page) */
  onStatusChange(fn) {
    this.statusListeners.add(fn);
    return () => {
      this.statusListeners.delete(fn);
    };
  }
  /** Current connection state */
  getConnState() {
    return this.connState;
  }
  /** Login state and binding info (shown on the settings page) */
  getState() {
    return this.store.get();
  }
  /** Whether polling is active */
  isPolling() {
    return this.polling;
  }
  /** HTTP transport layer (used for scanning in the settings page) */
  getTransport() {
    return this.transport;
  }
  /** ilink gateway address (scan-login always uses the default gateway) */
  getApiBase() {
    return ILINK_DEFAULT_BASE;
  }
  /** Persist the scan-login result and start polling */
  applyLogin(out) {
    this.store.update((st) => {
      st.token = out.token;
      st.botId = out.botId;
      st.baseUrl = out.baseUrl;
      st.scannedUser = out.scannedUser;
      st.cursor = "";
      st.contextTokens = {};
      st.pausedUntil = 0;
    });
    void this.store.saveNow();
    void this.startPollLoop();
  }
  /** Clear login credentials (re-scan required) */
  clearCredentials() {
    this.store.update((st) => {
      st.token = "";
      st.botId = "";
      st.baseUrl = "";
      st.scannedUser = "";
      st.cursor = "";
      st.contextTokens = {};
      st.pausedUntil = 0;
    });
    void this.store.saveNow();
    this.setConn("disconnected");
  }
  /** Start scan-login (for the command palette) */
  startLogin() {
    new QrLoginModal(this.app, this.transport, ILINK_DEFAULT_BASE, (out) => {
      this.applyLogin(out);
      new import_obsidian6.Notice(t("notice.loggedIn"));
    }).open();
  }
  /** Disconnect and clear login credentials */
  async logout() {
    this.disconnect();
    this.clearCredentials();
    new import_obsidian6.Notice(t("notice.loggedOut"));
  }
  /** Connect directly with the stored token */
  async connect() {
    const st = this.store.get();
    if (!st.token) {
      this.startLogin();
      return;
    }
    if (!this.polling) await this.startPollLoop();
  }
  disconnect() {
    this.stopAllTyping().catch(() => {
    });
    this.stopRequested = true;
    this.polling = false;
    this.client = null;
    this.setConn("disconnected");
  }
  /** Send a test message to the bound account (one-to-one; used by the settings page) */
  async sendTestMessage(text) {
    const st = this.store.get();
    const to = st.scannedUser.trim();
    if (!to || !st.token.trim()) return { ok: false, errmsg: t("sendTest.notBound"), ret: 0, contextToken: "" };
    const client = this.client ?? this.makeClient();
    const contextToken = st.contextTokens[to] ?? "";
    const res = await client.sendText(to, text, contextToken);
    if (res.ok) {
      const now = Date.now();
      await appendOutbound(this.app, this.settings.inboxFolder, now, to, [
        `**${timeOfDay(now)}** \xB7 ${t("importer.sent")}`,
        "",
        ...quoteBlock(text)
      ]);
    }
    return { ok: res.ok, errmsg: res.errmsg.trim() || res.raw || "", ret: res.ret, contextToken };
  }
  makeClient() {
    const st = this.store.get();
    return new IlinkClient(
      this.transport,
      {
        baseUrl: st.baseUrl || ILINK_DEFAULT_BASE,
        cdnBase: CDN_BASE
      },
      st.token
    );
  }
  /** Main long-poll loop */
  async startPollLoop() {
    if (this.polling) return;
    this.polling = true;
    this.stopRequested = false;
    this.client = this.makeClient();
    this.setConn("connecting");
    let backoff = 1e3;
    let typingFor = "";
    while (this.polling && !this.stopRequested) {
      const store = this.store;
      if (!store) break;
      const st = store.get();
      if (st.pausedUntil > Date.now()) {
        this.setConn("expired");
        await sleep(5e3);
        continue;
      }
      const result = await this.client.poll(st.cursor);
      if (result.sessionExpired) {
        store.update((s) => {
          s.pausedUntil = Date.now() + 36e5;
          s.lastError = t("error.sessionExpired");
        });
        this.setConn("expired");
        new import_obsidian6.Notice(t("notice.sessionExpired"));
        await sleep(3e4);
        continue;
      }
      if (result.error) {
        store.update((s) => {
          s.lastError = result.error ?? "";
        });
        this.setConn("error");
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 3e4);
        continue;
      }
      backoff = 1e3;
      this.setConn("connected");
      store.update((s) => {
        if (s.lastError !== "") s.lastError = "";
      });
      if (result.cursor && result.cursor !== st.cursor) {
        store.update((s) => {
          s.cursor = result.cursor ?? "";
        });
      }
      const receipts = [];
      for (const msg of result.messages) {
        receipts.push(...await this.handleInbound(msg));
        typingFor = msg.from;
      }
      if (typingFor) {
        const tFor = typingFor;
        typingFor = "";
        await this.stopTypingFor(tFor);
      }
      if (receipts.length) {
        await this.sendReceiptReplies(receipts);
      }
      try {
        await this.outbox?.flush(
          this.client,
          store,
          this.settings.outboxFolder,
          this.settings.inboxFolder,
          this.settings.attachmentFolder
        );
      } catch {
      }
      void store.saveNow();
    }
    this.polling = false;
  }
  /** Handle a single inbound message; returns a receipt entry when one should be sent */
  async handleInbound(msg) {
    const store = this.store;
    if (!store) return [];
    const scanned = store.get().scannedUser.trim();
    if (scanned && msg.from !== scanned) return [];
    const key = `${msg.from}|${msg.messageId}|${msg.timeMs}`;
    if (store.seen(key)) return [];
    const tok = (msg.raw.context_token ?? "").trim();
    if (tok) {
      store.update((s) => {
        s.contextTokens[msg.from] = tok;
      });
    }
    if (this.settings.notifyOnMessage) {
      const preview = msg.text.slice(0, 40) || `[${t("notice.attachments", { n: msg.attachments.length })}]`;
      new import_obsidian6.Notice(`${t("notice.prefix")} \xB7 ${msg.from.split("@")[0]}: ${preview}`);
    }
    void this.showTyping(msg.from, tok);
    if (this.settings.autoImport) {
      let result = null;
      try {
        result = await importMessage(this.app, this.articleTransport, msg, {
          inboxFolder: this.settings.inboxFolder,
          attachmentFolder: this.settings.attachmentFolder,
          articleFolder: this.settings.articleFolder,
          fetchArticles: this.settings.fetchArticles,
          groupArticlesByAccount: this.settings.groupArticlesByAccount
        });
      } catch (e) {
        new import_obsidian6.Notice(t("notice.importFailed", { err: String(e?.message ?? e) }));
      }
      if (this.settings.autoReply) {
        return [
          result ? {
            ok: true,
            appended: result.appended,
            dailyNote: result.dailyNote,
            attachmentPaths: result.attachmentPaths,
            attachmentFailures: result.attachmentFailures,
            linkCount: result.linkCount,
            articleAssets: result.articleAssets,
            articleFailures: result.articleFailures
          } : { ok: false, appended: false, dailyNote: "", attachmentPaths: [], attachmentFailures: [], linkCount: 0, articleAssets: [], articleFailures: [] }
        ];
      }
    }
    return [];
  }
  /**
   * One batched confirmation reply per polling round: a "received and saved"
   * line per recorded message, with failure reasons attached. Failures never
   * break the receive flow.
   */
  async sendReceiptReplies(receipts) {
    try {
      if (!receipts.length) return;
      const to = this.store.get().scannedUser.trim();
      if (!to) return;
      const client = this.client ?? this.makeClient();
      const contextToken = this.store.get().contextTokens[to] ?? "";
      const lines = buildReceiptReplies(receipts);
      if (!lines.length) return;
      const res = await client.sendText(to, lines.join("\n"), contextToken);
      if (res.ok) {
        await appendOutbound(this.app, this.settings.inboxFolder, Date.now(), to, [
          `**${timeOfDay(Date.now())}** \xB7 ${t("importer.sent")}`,
          "",
          ...quoteBlock(lines.join("\n"))
        ]);
      } else if (this.settings.notifyOnMessage) {
        new import_obsidian6.Notice(t("sendTest.failed", { err: buildSendFailure(res.errmsg, res.ret, contextToken) }), 1e4);
      }
    } catch {
    }
  }
  /* ------------------------------------------------------------- typing */
  /** Show the "typing" indicator while a message is being processed.
   * Fully best-effort: any failure (missing ticket, network error) is swallowed. */
  async showTyping(userId, contextToken) {
    try {
      const client = this.client ?? this.makeClient();
      const cached = this.store.get().typingTickets[userId];
      let ticket = cached && Date.now() - cached.at < TICKET_TTL_MS ? cached.ticket : "";
      if (!ticket) {
        const cfg = await client.getConfig(userId, contextToken);
        if (!cfg.typingTicket) return;
        ticket = cfg.typingTicket;
        this.store.update((s) => {
          s.typingTickets[userId] = { ticket, at: Date.now() };
        });
      }
      if (!await client.sendTyping(userId, ticket, true)) {
        this.store.update((s) => {
          delete s.typingTickets[userId];
        });
        const cfg = await client.getConfig(userId, contextToken);
        if (!cfg.typingTicket) return;
        this.store.update((s) => {
          s.typingTickets[userId] = { ticket: cfg.typingTicket, at: Date.now() };
        });
        await client.sendTyping(userId, cfg.typingTicket, true);
      }
    } catch {
    }
  }
  /** Cancel the "typing" indicator for one user (best-effort) */
  async stopTypingFor(userId) {
    try {
      const cached = this.store.get().typingTickets[userId];
      if (!cached) return;
      const client = this.client ?? this.makeClient();
      await client.sendTyping(userId, cached.ticket, false);
    } catch {
    }
  }
  /** Cancel typing for all cached tickets (used on disconnect; best-effort) */
  async stopAllTyping() {
    try {
      const st = this.store.get();
      const users = Object.keys(st.typingTickets);
      if (!users.length) return;
      const client = this.client ?? this.makeClient();
      await Promise.all(users.map((u) => client.sendTyping(u, st.typingTickets[u].ticket, false)));
    } catch {
    }
  }
  async openTodayInbox() {
    const d = /* @__PURE__ */ new Date();
    const pad2 = (n) => n < 10 ? `0${n}` : String(n);
    const today = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const path = `${this.settings.inboxFolder}/${today}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof import_obsidian6.TFile) {
      await this.app.workspace.getLeaf().openFile(file);
    } else {
      new import_obsidian6.Notice(t("notice.noMsgToday", { path }));
    }
  }
};
