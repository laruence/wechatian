"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
function encryptEcb(plain, key) {
  const c = (0, import_crypto.createCipheriv)("aes-128-ecb", key, null);
  c.setAutoPadding(true);
  return Buffer.concat([c.update(plain), c.final()]);
}
function downloadUrl(cdnBase, encParam) {
  return `${cdnBase.replace(/\/$/, "")}/download?encrypted_query_param=${encodeURIComponent(encParam)}`;
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
    const attachments = await this.collectMedia(items);
    if (!text.trim() && attachments.length === 0) return null;
    return {
      from,
      messageId: m.message_id ? String(m.message_id) : `${m.create_time_ms ?? Date.now()}`,
      timeMs: m.create_time_ms ?? Date.now(),
      text,
      attachments,
      raw: m
    };
  }
  /** Download and decrypt media in the message; a single failure is skipped without affecting text */
  async collectMedia(items) {
    const out = [];
    const cdnBase = this.opts.cdnBase.replace(/\/$/, "");
    if (!cdnBase) return out;
    const tasks = [];
    const grab = (media, aesKeyB64, kind, name, mime) => {
      const enc = (media?.encrypt_query_param ?? "").trim();
      if (!enc) return;
      const key = aesKeyB64 ? parseAesKey(aesKeyB64) : null;
      const url = downloadUrl(cdnBase, enc);
      tasks.push(
        this.transport.get(url, {}, 6e4).then((r) => {
          let buf = Buffer.from(r.body);
          if (key) buf = decryptEcb(buf, key);
          out.push({ kind, name, mime, data: new Uint8Array(buf) });
        }).catch(() => void 0)
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
          grab(img.media, keyB64, "image", `image_${out.length}.bin`, "image/*");
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
          grab(v.media, v.media.aes_key, "video", `video_${out.length}.mp4`, "video/mp4");
          break;
        }
        case ITEM_VOICE: {
          const v = it.voice_item;
          if (!v?.media || (v.text ?? "").trim()) break;
          grab(v.media, v.media.aes_key, "audio", `voice_${out.length}.silk`, "audio/silk");
          break;
        }
      }
    }
    await Promise.all(tasks);
    return out;
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
    const cipher = encryptEcb(plain, key);
    const downloadParam = await this.uploadCipher(uploadUrl, cipher);
    return { downloadParam, aesKey: key, cipherSize: cipher.length, rawSize: plain.length };
  }
  /** POST ciphertext to the CDN; the x-encrypted-param response header is the download credential */
  async uploadCipher(url, cipher) {
    let lastErr = "";
    const body = cipher.buffer.slice(cipher.byteOffset, cipher.byteOffset + cipher.byteLength);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await this.transport.post(url, { "Content-Type": "application/octet-stream" }, body, 12e4);
        if (r.status >= 400 && r.status < 500) {
          const msg = r.headers["x-error-message"] || `http ${r.status}`;
          throw new Error(`CDN upload client error: ${msg}`);
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

// src/core/store.ts
var DEDUP_KEEP = 500;
var StateStore = class {
  constructor(app, file) {
    this.app = app;
    this.file = file;
    this.state = this.load();
  }
  state;
  saveTimer = null;
  emptyState() {
    return {
      token: "",
      botId: "",
      baseUrl: "",
      scannedUser: "",
      cursor: "",
      contextTokens: {},
      quotaTimes: [],
      pausedUntil: 0,
      dedup: [],
      lastError: "",
      lastPollAt: 0
    };
  }
  load() {
    return this.emptyState();
  }
  /** adapter reads are async; await once at plugin startup */
  async init() {
    try {
      if (await this.app.vault.adapter.exists(this.file)) {
        const raw = await this.app.vault.adapter.read(this.file);
        this.state = { ...this.emptyState(), ...JSON.parse(raw) };
      }
    } catch {
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
    }
    try {
      await this.app.vault.adapter.write(this.file, JSON.stringify(this.state));
    } catch {
    }
  }
  /** Message dedup: returns true if this key was already seen */
  seen(key) {
    if (this.state.dedup.includes(key)) return true;
    this.state.dedup.push(key);
    this.scheduleSave();
    return false;
  }
};

// src/core/importer.ts
var import_obsidian3 = require("obsidian");

// src/core/article.ts
function extractLinks(text) {
  const out = [];
  const re = /https?:\/\/[^\s<>"'，。、）》]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0].replace(/[.,!?;:]+$/, ""));
  }
  return out;
}
async function fetchArticleInfo(transport, url) {
  try {
    const resp = await transport.get(
      url,
      {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml"
      },
      2e4
    );
    if (resp.status !== 200) return null;
    const html = bodyText(resp);
    const title = ogTag(html, "og:title") || titleTag(html);
    const description = ogTag(html, "og:description") || metaTag(html, "description");
    if (!title) return null;
    return { url, title: cleanText(title), description: cleanText(description) };
  } catch {
    return null;
  }
}
function ogTag(html, prop) {
  const m = html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i")) ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${prop}["']`, "i"));
  return m ? decodeEntities(m[1]) : "";
}
function metaTag(html, name) {
  const m = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, "i"));
  return m ? decodeEntities(m[1]) : "";
}
function titleTag(html) {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? decodeEntities(m[1]) : "";
}
function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}
function cleanText(s) {
  return s.replace(/\s+/g, " ").trim();
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
  "status.disconnected": "\u{1F4F4} disconnected",
  "status.connecting": "\u23F3 connecting",
  "status.connected": "\u{1F7E2} WeChat online",
  "status.expired": "\u26A0\uFE0F session expired",
  "status.error": "\u{1F534} connection error",
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
  "set.sentFolder": "Sent folder",
  "set.sentFolder.desc": "Copies of successfully sent messages (test sends and outbox sends) are archived here",
  "set.autoImport": "Auto-import messages",
  "set.autoImport.desc": "Write messages into the inbox as soon as they arrive",
  "set.fetchArticles": "Fetch article info",
  "set.fetchArticles.desc": "Automatically fetch the title/summary of links in messages and create article notes",
  "set.notify": "Notify on message",
  "set.footer": "Note: this plugin talks to the WeChat ilink gateway directly; messages are stored only in this vault. Sending is rate-limited by the gateway (roughly 4-6 proactive messages per day).",
  "login.status": "Login status",
  "login.bound": "\u2705 Bound \xB7 bot {{bot}} \xB7 scanning user {{user}}",
  "login.rescan": "Re-scan",
  "login.logout": "Log out",
  "login.notLoggedIn": "Not logged in to WeChat yet. Scan the QR code below to bind:",
  "login.fetching": "Fetching QR code\u2026",
  "login.waiting": "Waiting for scan\u2026",
  "login.scanned": "Scanned \u2014 please confirm on your phone\u2026",
  "login.success": "\u2705 Logged in",
  "modal.title": "WeChat Scan Login",
  "modal.hint": "Scan the QR code below with WeChat, then confirm login on your phone.",
  "modal.renderFailed": "Failed to render QR code: {{err}}",
  "modal.openLink": "or tap this link to open on your phone",
  "importer.attachFailed": "Failed to save attachment: {{name}}",
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
  "sendTest.ok": "\u2705 Message sent",
  "sendTest.empty": "Nothing to send",
  "sendTest.failed": "Send failed: {{err}}",
  "sendTest.notBound": "Not logged in yet",
  "sendTest.needFirstMessage": "No send credential yet \u2014 send any message to the bot from WeChat first, then retry",
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
  "status.disconnected": "\u{1F4F4} \u672A\u8FDE\u63A5",
  "status.connecting": "\u23F3 \u8FDE\u63A5\u4E2D",
  "status.connected": "\u{1F7E2} \u5FAE\u4FE1\u5728\u7EBF",
  "status.expired": "\u26A0\uFE0F \u4F1A\u8BDD\u8FC7\u671F",
  "status.error": "\u{1F534} \u8FDE\u63A5\u9519\u8BEF",
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
  "set.sentFolder": "\u5DF2\u53D1\u9001\u76EE\u5F55",
  "set.sentFolder.desc": "\u53D1\u9001\u6210\u529F\u7684\u6D88\u606F\u526F\u672C(\u6D4B\u8BD5\u53D1\u9001\u4E0E\u53D1\u4EF6\u7BB1\u53D1\u9001)\u5B58\u6863\u5728\u6B64",
  "set.autoImport": "\u81EA\u52A8\u5BFC\u5165\u6D88\u606F",
  "set.autoImport.desc": "\u6536\u5230\u6D88\u606F\u540E\u7ACB\u5373\u5199\u5165\u6536\u4EF6\u7BB1",
  "set.fetchArticles": "\u6293\u53D6\u6587\u7AE0\u4FE1\u606F",
  "set.fetchArticles.desc": "\u6D88\u606F\u91CC\u7684\u94FE\u63A5\u81EA\u52A8\u6293\u53D6\u6807\u9898/\u6458\u8981\u5E76\u5EFA\u7ACB\u6587\u7AE0\u7B14\u8BB0",
  "set.notify": "\u6765\u6D88\u606F\u65F6\u901A\u77E5",
  "set.footer": "\u8BF4\u660E:\u672C\u63D2\u4EF6\u76F4\u63A5\u4E0E\u5FAE\u4FE1 ilink \u7F51\u5173\u901A\u4FE1,\u6D88\u606F\u4EC5\u4FDD\u5B58\u5728\u672C vault\u3002\u53D1\u9001\u53D7\u7F51\u5173\u9650\u6D41(\u7EA6\u6BCF\u5929 4-6 \u6761\u4E3B\u52A8\u6D88\u606F)\u3002",
  "login.status": "\u767B\u5F55\u72B6\u6001",
  "login.bound": "\u2705 \u5DF2\u7ED1\u5B9A \xB7 \u673A\u5668\u4EBA {{bot}} \xB7 \u626B\u7801\u7528\u6237 {{user}}",
  "login.rescan": "\u91CD\u65B0\u626B\u7801",
  "login.logout": "\u9000\u51FA\u767B\u5F55",
  "login.notLoggedIn": "\u5C1A\u672A\u767B\u5F55\u5FAE\u4FE1\u3002\u626B\u63CF\u4E0B\u65B9\u4E8C\u7EF4\u7801\u7ED1\u5B9A:",
  "login.fetching": "\u6B63\u5728\u83B7\u53D6\u4E8C\u7EF4\u7801\u2026",
  "login.waiting": "\u7B49\u5F85\u626B\u7801\u2026",
  "login.scanned": "\u5DF2\u626B\u7801,\u8BF7\u5728\u624B\u673A\u4E0A\u786E\u8BA4\u2026",
  "login.success": "\u2705 \u767B\u5F55\u6210\u529F",
  "modal.title": "\u5FAE\u4FE1\u626B\u7801\u767B\u5F55",
  "modal.hint": "\u7528\u5FAE\u4FE1\u626B\u63CF\u4E0B\u65B9\u4E8C\u7EF4\u7801,\u7136\u540E\u5728\u624B\u673A\u4E0A\u786E\u8BA4\u767B\u5F55\u3002",
  "modal.renderFailed": "\u4E8C\u7EF4\u7801\u6E32\u67D3\u5931\u8D25: {{err}}",
  "modal.openLink": "\u6216\u70B9\u51FB\u6B64\u94FE\u63A5\u5728\u624B\u673A\u6253\u5F00",
  "importer.attachFailed": "\u9644\u4EF6\u4FDD\u5B58\u5931\u8D25: {{name}}",
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
  "sendTest.ok": "\u2705 \u6D88\u606F\u5DF2\u53D1\u9001",
  "sendTest.empty": "\u5185\u5BB9\u4E3A\u7A7A,\u6CA1\u6709\u53EF\u53D1\u9001\u7684\u6D88\u606F",
  "sendTest.failed": "\u53D1\u9001\u5931\u8D25: {{err}}",
  "sendTest.notBound": "\u5C1A\u672A\u767B\u5F55",
  "sendTest.needFirstMessage": "\u8FD8\u6CA1\u6709\u53D1\u9001\u51ED\u636E\u2014\u2014\u8BF7\u5148\u4ECE\u5FAE\u4FE1\u7ED9\u673A\u5668\u4EBA\u53D1\u4E00\u6761\u6D88\u606F,\u518D\u91CD\u8BD5",
  "set.agentGuide": "Agent \u6307\u5F15",
  "set.agentGuide.desc": "\u8BA9\u4F60\u7684 agent(Claude \u7B49)\u8BFB\u53D6 vault \u4E2D\u7684 {{path}},\u5373\u53EF\u5B66\u4F1A\u901A\u8FC7\u53D1\u4EF6\u7BB1\u53D1\u9001\u5FAE\u4FE1\u6D88\u606F\u548C\u9644\u4EF6"
};
function detectDict() {
  try {
    return (0, import_obsidian2.getLanguage)().toLowerCase().startsWith("zh") ? zh : en;
  } catch {
    return en;
  }
}
var dict = detectDict();
var choice = "system";
function applyLanguage(lang) {
  choice = lang;
  dict = lang === "system" ? detectDict() : lang === "zh" ? zh : en;
}
function resolvedLanguage() {
  return dict === zh ? "zh" : "en";
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
function sentStamp(ts) {
  const d = new Date(ts);
  return `${dayStamp(ts)}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, "_").trim() || "untitled";
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
  const result = { appended: false, articleNotes: [] };
  await ensureFolder(app, settings.inboxFolder);
  await ensureFolder(app, settings.attachmentFolder);
  await ensureFolder(app, settings.articleFolder);
  const lines = [];
  lines.push(`**${timeOfDay(msg.timeMs)}**`);
  if (msg.text.trim()) {
    lines.push("");
    lines.push(msg.text.trim());
  }
  for (const att of msg.attachments) {
    let ext = att.name.includes(".") ? att.name.split(".").pop() : "";
    if (att.kind === "image") ext = ext && ext !== "bin" ? ext : "jpg";
    const base = `${dayStamp(msg.timeMs)}_${timeOfDay(msg.timeMs).replace(":", "")}`;
    const path = `${settings.attachmentFolder}/${base}_${sanitizeFileName(att.name.replace(/\.[^.]+$/, "") || att.kind)}.${ext || "bin"}`;
    try {
      const ab = att.data.buffer.slice(att.data.byteOffset, att.data.byteOffset + att.data.byteLength);
      await app.vault.adapter.writeBinary(path, ab);
      const rel = path;
      if (att.kind === "image") {
        lines.push("");
        lines.push(`![[${rel}]]`);
      } else {
        lines.push("");
        lines.push(`[[${rel}|${att.name}]]`);
      }
    } catch {
      lines.push("");
      lines.push(`> ${t("importer.attachFailed", { name: att.name })}`);
    }
  }
  const links = extractLinks(msg.text);
  if (settings.fetchArticles && links.length) {
    for (const url of links.slice(0, 5)) {
      const info = await fetchArticleInfo(transport, url);
      const title = info?.title || url;
      const notePath = `${settings.articleFolder}/${dayStamp(msg.timeMs)} ${sanitizeFileName(title)}.md`;
      try {
        if (!await app.vault.adapter.exists(notePath)) {
          const body = [
            `# ${title}`,
            "",
            `> **${t("importer.source")}**: ${url}`,
            `> **${t("importer.imported")}**: ${new Date(msg.timeMs).toLocaleString()}`,
            `> **${t("importer.from")}**: ${msg.from}`,
            info?.description ? `> **${t("importer.summary")}**: ${info.description}` : "",
            ""
          ].join("\n");
          await app.vault.create(notePath, body);
          result.articleNotes.push(notePath);
        }
        lines.push("");
        lines.push(`[[${notePath.replace(/\.md$/, "")}|${title}]]`);
      } catch {
      }
    }
  }
  const dailyPath = `${settings.inboxFolder}/${dayStamp(msg.timeMs)}.md`;
  const header = `---
date: ${dayStamp(msg.timeMs)}
sender: ${msg.from}
---

# ${t("importer.inboxTitle", { date: dayStamp(msg.timeMs) })}

`;
  const block = lines.join("\n") + "\n\n";
  try {
    const exists = await app.vault.adapter.exists(dailyPath);
    const prev = exists ? await app.vault.adapter.read(dailyPath) : header;
    await app.vault.adapter.write(dailyPath, prev + block);
    result.appended = true;
  } catch {
  }
  return result;
}

// src/core/agent-guide.ts
function agentGuideMeta(content) {
  const fm = /^---\s*\n([\s\S]*?)\n---/.exec(content)?.[1] ?? "";
  const lang = /lang:\s*"?(\w+)"?/.exec(fm)?.[1] ?? "";
  const paths = /paths:\s*"([^"]*)"/.exec(fm)?.[1] ?? "";
  return { lang, paths };
}
function pathsKey(s) {
  return [s.inboxFolder, s.outboxFolder, s.sentFolder, s.attachmentFolder].join("|");
}
function buildEn(s) {
  return `---
lang: en
paths: "${pathsKey(s)}"
---

# WeChat Send (Wechatian)

This Obsidian vault runs the Wechatian plugin, which exposes a one-to-one WeChat channel: every message goes to the vault owner's own bound WeChat account.

## Sending

Write a file into the outbox folder \`${s.outboxFolder}/\`:

- \`.md\` file: the content is sent as a text message (the file name carries no meaning)
- Image (\`.jpg/.png/.gif/.webp\`), video (\`.mp4\` etc.) or document (\`.pdf/.docx/...\`, \u2264100MB): sent as an attachment

The plugin consumes the outbox on its next poll (~30-60 s). A successful send deletes the file and archives a copy under \`${s.sentFolder}/\`; a failure keeps the file (an \`.md\` gets a \`<!-- Wechatian send failed: ... -->\` comment appended, a media file gets a \`<name>.wechatian-failed.md\` sidecar). After writing, wait about a minute and check whether the file still exists to determine the result.

## Receiving

Inbound WeChat messages are appended to daily inbox notes under \`${s.inboxFolder}/\`; media arrives under \`${s.attachmentFolder}/\`.

## Constraints

The gateway rate-limits proactive sends (~4-6 per day). Use this channel for notifications (task finished, long job done), not for conversation.
`;
}
function buildZh(s) {
  return `---
lang: zh
paths: "${pathsKey(s)}"
---

# \u5FAE\u4FE1\u53D1\u9001(Wechatian)

\u672C vault \u88C5\u4E86 Wechatian \u63D2\u4EF6,\u63D0\u4F9B\u4E00\u6761\u4E00\u5BF9\u4E00\u5FAE\u4FE1\u901A\u9053:\u6240\u6709\u6D88\u606F\u90FD\u53D1\u7ED9 vault \u4E3B\u4EBA\u81EA\u5DF1\u7ED1\u5B9A\u7684\u5FAE\u4FE1\u3002

## \u53D1\u9001

\u5F80\u53D1\u4EF6\u7BB1\u76EE\u5F55 \`${s.outboxFolder}/\` \u5199\u4E00\u4E2A\u6587\u4EF6:

- \`.md\` \u6587\u4EF6:\u5185\u5BB9\u4F5C\u4E3A\u6587\u672C\u6D88\u606F\u53D1\u9001(\u6587\u4EF6\u540D\u65E0\u8BED\u4E49)
- \u56FE\u7247(\`.jpg/.png/.gif/.webp\`)\u3001\u89C6\u9891(\`.mp4\` \u7B49)\u6216\u6587\u6863(\`.pdf/.docx/...\`,\u2264100MB):\u4F5C\u4E3A\u9644\u4EF6\u53D1\u9001

\u63D2\u4EF6\u5728\u4E0B\u4E00\u8F6E\u8F6E\u8BE2(\u7EA6 30-60 \u79D2)\u6D88\u8D39\u53D1\u4EF6\u7BB1\u3002\u53D1\u9001\u6210\u529F\u4F1A\u5220\u9664\u6587\u4EF6,\u5E76\u5728 \`${s.sentFolder}/\` \u5B58\u6863\u4E00\u4EFD\u526F\u672C;\u5931\u8D25\u4F1A\u4FDD\u7559\u6587\u4EF6(\`.md\` \u672B\u5C3E\u8FFD\u52A0 \`<!-- Wechatian send failed: ... -->\` \u6CE8\u91CA,\u5A92\u4F53\u6587\u4EF6\u751F\u6210 \`<\u6587\u4EF6\u540D>.wechatian-failed.md\` \u8BB0\u5F55)\u3002\u5199\u5165\u540E\u7B49\u7EA6\u4E00\u5206\u949F,\u68C0\u67E5\u6587\u4EF6\u662F\u5426\u8FD8\u5728\u4EE5\u5224\u65AD\u7ED3\u679C\u3002

## \u63A5\u6536

\u6536\u5230\u7684\u5FAE\u4FE1\u6D88\u606F\u4F1A\u8FFD\u52A0\u5230 \`${s.inboxFolder}/\` \u4E0B\u7684\u6BCF\u65E5\u6536\u4EF6\u7BB1\u7B14\u8BB0,\u5A92\u4F53\u9644\u4EF6\u4FDD\u5B58\u5728 \`${s.attachmentFolder}/\`\u3002

## \u9650\u5236

\u7F51\u5173\u5BF9\u4E3B\u52A8\u6D88\u606F\u9650\u6D41(\u7EA6\u6BCF\u5929 4-6 \u6761)\u3002\u7528\u4E8E\u901A\u77E5(\u4EFB\u52A1\u5B8C\u6210\u3001\u957F\u4EFB\u52A1\u7ED3\u675F),\u4E0D\u8981\u5F53\u804A\u5929\u901A\u9053\u3002
`;
}
async function ensureAgentGuide(app, s, lang) {
  const path = `${s.inboxFolder}/Agent.md`;
  const target = lang === "zh" ? buildZh(s) : buildEn(s);
  try {
    if (await app.vault.adapter.exists(path)) {
      const cur = agentGuideMeta(await app.vault.adapter.read(path));
      if (cur.lang === lang && cur.paths === pathsKey(s)) return;
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
        await sleep2(1e3);
        continue;
      }
    }
    let st;
    try {
      st = await pollQrStatus(transport, apiBase, cur.qrKey);
    } catch (e) {
      cb.onError(t("qr.queryFailed", { err: String(e?.message ?? e) }));
      await sleep2(1e3);
      continue;
    }
    if (cb.cancelled()) return null;
    switch (st.status) {
      case "wait":
      case "":
        await sleep2(200);
        break;
      case "scaned":
        if (!scannedPrinted) {
          scannedPrinted = true;
          cb.onScanned();
        }
        await sleep2(300);
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
          await sleep2(1e3);
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
        await sleep2(500);
    }
  }
  cb.onError(t("qr.timeout"));
  return null;
}
function sleep2(ms) {
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
  sentFolder: "Wechatian/sentbox",
  fetchArticles: true,
  autoImport: true,
  notifyOnMessage: true
};
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
  display() {
    this.alive = true;
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian4.Setting(containerEl).setName(t("set.autoConnect")).setDesc(t("set.autoConnect.desc")).addToggle(
      (t2) => t2.setValue(this.plugin.settings.enabled).onChange(async (v) => {
        this.plugin.settings.enabled = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian4.Setting(containerEl).setName(t("set.language")).setDesc(t("set.language.desc")).addDropdown((d) => {
      d.addOption("system", t("set.language.system")).addOption("en", "English").addOption("zh", "\u4E2D\u6587").setValue(this.plugin.settings.language).onChange(async (v) => {
        const lang = ["system", "en", "zh"].includes(v) ? v : "system";
        this.plugin.settings.language = lang;
        await this.plugin.saveSettings();
        this.plugin.applyLanguage(lang);
        this.display();
      });
    });
    this.renderLoginSection(containerEl);
    new import_obsidian4.Setting(containerEl).setName(t("set.inboxFolder")).setDesc(t("set.inboxFolder.desc")).addText(
      (t2) => t2.setValue(this.plugin.settings.inboxFolder).onChange(async (v) => {
        this.plugin.settings.inboxFolder = v.trim() || "Wechatian";
        await this.plugin.saveSettings();
        this.plugin.refreshAgentGuide();
      })
    );
    new import_obsidian4.Setting(containerEl).setName(t("set.attachmentFolder")).setDesc(t("set.attachmentFolder.desc")).addText(
      (t2) => t2.setValue(this.plugin.settings.attachmentFolder).onChange(async (v) => {
        this.plugin.settings.attachmentFolder = v.trim() || "Wechatian/attachments";
        await this.plugin.saveSettings();
        this.plugin.refreshAgentGuide();
      })
    );
    new import_obsidian4.Setting(containerEl).setName(t("set.articleFolder")).setDesc(t("set.articleFolder.desc")).addText(
      (t2) => t2.setValue(this.plugin.settings.articleFolder).onChange(async (v) => {
        this.plugin.settings.articleFolder = v.trim() || "Wechatian/articles";
        await this.plugin.saveSettings();
        this.plugin.refreshAgentGuide();
      })
    );
    new import_obsidian4.Setting(containerEl).setName(t("set.outboxFolder")).setDesc(t("set.outboxFolder.desc")).addText(
      (t2) => t2.setValue(this.plugin.settings.outboxFolder).onChange(async (v) => {
        this.plugin.settings.outboxFolder = v.trim() || "Wechatian/outbox";
        await this.plugin.saveSettings();
        this.plugin.refreshAgentGuide();
      })
    );
    new import_obsidian4.Setting(containerEl).setName(t("set.sentFolder")).setDesc(t("set.sentFolder.desc")).addText(
      (t2) => t2.setValue(this.plugin.settings.sentFolder).onChange(async (v) => {
        this.plugin.settings.sentFolder = v.trim() || "Wechatian/sentbox";
        await this.plugin.saveSettings();
        this.plugin.refreshAgentGuide();
      })
    );
    new import_obsidian4.Setting(containerEl).setName(t("set.autoImport")).setDesc(t("set.autoImport.desc")).addToggle(
      (t2) => t2.setValue(this.plugin.settings.autoImport).onChange(async (v) => {
        this.plugin.settings.autoImport = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian4.Setting(containerEl).setName(t("set.fetchArticles")).setDesc(t("set.fetchArticles.desc")).addToggle(
      (t2) => t2.setValue(this.plugin.settings.fetchArticles).onChange(async (v) => {
        this.plugin.settings.fetchArticles = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian4.Setting(containerEl).setName(t("set.notify")).addToggle(
      (t2) => t2.setValue(this.plugin.settings.notifyOnMessage).onChange(async (v) => {
        this.plugin.settings.notifyOnMessage = v;
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("p", {
      text: t("set.footer"),
      cls: "setting-item-description"
    });
    new import_obsidian4.Setting(containerEl).setName(t("set.agentGuide")).setDesc(
      t("set.agentGuide.desc", { path: `${this.plugin.settings.inboxFolder}/Agent.md` })
    );
  }
  /** Login-status section: shows the bound ID when logged in; inline QR code otherwise */
  renderLoginSection(containerEl) {
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
          this.display();
        })
      );
      let testInput = null;
      new import_obsidian4.Setting(section).setName(t("sendTest.name")).setDesc(t("sendTest.desc")).addText((txt) => {
        txt.setPlaceholder("Hello, I'm Wechatian").setValue("Hello, I'm Wechatian");
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
          } else if (/context[_ ]?token/i.test(res.errmsg)) {
            new import_obsidian4.Notice(t("sendTest.needFirstMessage"));
          } else {
            new import_obsidian4.Notice(t("sendTest.failed", { err: res.errmsg }));
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
        if (this.alive) statusEl.setText(`\u26A0\uFE0F ${msg}`);
      },
      cancelled: () => !this.alive
    });
    if (!this.alive) return;
    if (out) {
      this.plugin.applyLogin(out);
      new import_obsidian4.Notice(t("notice.loggedIn"));
      this.display();
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
      el.createEl("div", { text: url });
    }
    el.createEl("div", { text: url, cls: "wechatian-qr-url" });
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
   * Successful sends are archived into sentFolder before the outbox file is deleted.
   */
  async flush(client, store, folder, sentFolder) {
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
      if (ext === "md") {
        processed += await this.flushTextFile(client, path, to, contextToken, sentFolder);
        continue;
      }
      if (IMAGE_EXTS.has(ext) || isVideoExt(ext) || BINARY_EXTS.has(ext)) {
        processed += await this.flushMediaFile(client, path, name, to, contextToken, sentFolder);
      }
    }
    return processed;
  }
  /** Copy the sent content into the sent folder (best-effort; the send itself already succeeded) */
  async archive(sentFolder, fileName, content) {
    if (!sentFolder) return;
    try {
      await ensureFolder(this.app, sentFolder);
      const path = `${sentFolder}/${sentStamp(Date.now())}_${sanitizeFileName(fileName)}`;
      await this.app.vault.adapter.write(path, content);
    } catch {
    }
  }
  /** .md -> send the content as a text message */
  async flushTextFile(client, path, to, contextToken, sentFolder) {
    const content = (await this.app.vault.adapter.read(path)).trim();
    if (!content) {
      await this.app.vault.adapter.remove(path);
      return 0;
    }
    const res = await client.sendText(to, content, contextToken);
    if (res.ok) {
      await this.archive(sentFolder, path.split("/").pop() ?? "message.md", `${content}
`);
      await this.app.vault.adapter.remove(path);
      return 1;
    }
    const note = `

<!-- ${t("outbox.failedNote", { ret: res.ret, msg: res.errmsg.trim() || res.raw || "unknown" })} -->
`;
    await this.app.vault.adapter.write(path, content + note);
    return 0;
  }
  /** image/video/file -> AES-ECB encrypt, upload to CDN, send as a media message */
  async flushMediaFile(client, path, name, to, contextToken, sentFolder) {
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
      await this.archive(sentFolder, name, "");
      await this.app.vault.adapter.remove(path);
      return 1;
    }
    const notePath = `${path}.wechatian-failed.md`;
    const note = `# ${name}

${t("outbox.failedNote", { ret: res.ret, msg: res.errmsg.trim() || res.raw || "unknown" })}
`;
    await this.app.vault.adapter.write(notePath, note);
    return 0;
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
var STATE_FILE = ".wechatian-plugin/state.json";
var WechatianPlugin = class extends import_obsidian6.Plugin {
  settings = DEFAULT_SETTINGS;
  store;
  client = null;
  transport = new ObsidianTransport();
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
    this.store = new StateStore(this.app, STATE_FILE);
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
    }
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});
    if (raw && typeof raw === "object" && !("sentFolder" in raw)) {
      this.settings.sentFolder = `${this.settings.inboxFolder}/sentbox`;
    }
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
    for (const folder of [s.inboxFolder, s.attachmentFolder, s.articleFolder, s.outboxFolder, s.sentFolder]) {
      try {
        await ensureFolder(this.app, folder);
      } catch {
      }
    }
    await ensureAgentGuide(this.app, s, resolvedLanguage());
  }
  /** Archive a successfully sent text message into the sent folder */
  async archiveSent(text, source) {
    const path = `${this.settings.sentFolder}/${sentStamp(Date.now())}_${source}_${sanitizeFileName(text.slice(0, 20)) || "message"}.md`;
    try {
      await ensureFolder(this.app, this.settings.sentFolder);
      await this.app.vault.adapter.write(path, `${text.trim()}
`);
    } catch {
    }
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
    this.stopRequested = true;
    this.polling = false;
    this.client = null;
    this.setConn("disconnected");
  }
  /** Send a test message to the bound account (one-to-one; used by the settings page) */
  async sendTestMessage(text) {
    const st = this.store.get();
    const to = st.scannedUser.trim();
    if (!to || !st.token.trim()) return { ok: false, errmsg: t("sendTest.notBound") };
    const client = this.client ?? this.makeClient();
    const res = await client.sendText(to, text, st.contextTokens[to] ?? "");
    if (res.ok) await this.archiveSent(text, "test");
    return { ok: res.ok, errmsg: res.errmsg.trim() || res.raw || "" };
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
        s.lastError = "";
        s.lastPollAt = Date.now();
      });
      if (result.cursor) {
        store.update((s) => {
          s.cursor = result.cursor ?? "";
        });
      }
      for (const msg of result.messages) {
        await this.handleInbound(msg);
      }
      try {
        await this.outbox?.flush(this.client, store, this.settings.outboxFolder, this.settings.sentFolder);
      } catch {
      }
      void store.saveNow();
    }
    this.polling = false;
  }
  /** Handle a single inbound message */
  async handleInbound(msg) {
    const store = this.store;
    if (!store) return;
    const scanned = store.get().scannedUser.trim();
    if (scanned && msg.from !== scanned) return;
    const key = `${msg.from}|${msg.messageId}|${msg.timeMs}`;
    if (store.seen(key)) return;
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
    if (this.settings.autoImport) {
      try {
        await importMessage(this.app, this.transport, msg, {
          inboxFolder: this.settings.inboxFolder,
          attachmentFolder: this.settings.attachmentFolder,
          articleFolder: this.settings.articleFolder,
          fetchArticles: this.settings.fetchArticles
        });
      } catch (e) {
        new import_obsidian6.Notice(t("notice.importFailed", { err: String(e?.message ?? e) }));
      }
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
