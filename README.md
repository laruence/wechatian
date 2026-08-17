# Wechatian

An [Obsidian](https://obsidian.md) plugin that turns WeChat into a two-way bridge for your vault, through Tencent's official **ilink** bot gateway — no unofficial protocol hacks, no self-hosted relay.

## Features

- **Inbox** — incoming WeChat messages become daily conversation notes (`<inbox>/YYYY-MM-DD.md`, received + sent in one timeline); media decrypted into `attachments/`; links fetched in full as markdown article notes
- **Outbox** — a file-based send channel: drop an `.md` (sent as text, **markdown supported**) or an image / video / document ≤100MB (sent as an attachment) into `outbox/`
- **Agent-ready** — the plugin maintains an `Agent.md` in the inbox folder teaching any AI assistant the outbox protocol; see [Agent.md](Agent.md) in this repo for the full guide
- **QR login** — scan once; the plugin binds to the scanning account and only accepts messages from it
- **Bilingual UI** — English / 中文 / follow Obsidian

## Install

**Community store (recommended):** Obsidian → Settings → Community plugins, search **Wechatian**, install and enable.

**From a release:** copy `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/laruence/wechatian/releases/latest) into `<vault>/.obsidian/plugins/wechatian/` and enable (assets are CI-built and signed: `gh attestation verify main.js --owner laruence`).

**From source:**

```bash
git clone https://github.com/laruence/wechatian.git && cd wechatian
npm install
OBSIDIAN_PLUGIN_DIR=/path/to/vault/.obsidian/plugins/wechatian npm run build
```

**Via AI agent:** hand it this repo and say *"Read the README and install Wechatian into my vault."*

## Quick start

1. Open Wechatian settings — a QR code appears
2. Scan with WeChat and confirm — a bot contact appears in your contacts
3. **Send any message to the bot from WeChat once** — the gateway only issues the send credential after the bound account has messaged the bot
4. Status bar shows "WeChat online"; you're live in both directions

## Usage

```
Wechatian/              # inbox folder (all paths configurable)
├── Agent.md            # instructions for AI agents (plugin-maintained)
├── 2026-08-17.md       # daily conversation note (received + sent)
├── attachments/        # media
├── articles/           # full-text article notes
└── outbox/             # write a file here to send it
```

| Write into `outbox/` | Result |
|---|---|
| `notify.md` | content sent as a text message (markdown supported) |
| `chart.png`, `report.pdf` … | sent as an attachment |

The plugin picks files up on its next poll (~30–60 s): file gone = sent (recorded in the daily note); file present = failed (trailing `<!-- ... -->` comment or `.wechatian-failed.md` sidecar explains why). One-to-one channel — no recipient is ever specified.

**AI assistants:** read [Agent.md](Agent.md) (and the runtime `<inbox>/Agent.md` in a live vault) — it documents the protocol, result judging, reply reading and rate limits. Never call any API; the file channel is the whole interface.

## Good to know

- **Rate limit** — the gateway throttles proactive sends; this is a notification/decision channel, not a chat tool
- **One device per account** — concurrent long polling from multiple devices competes for the message stream
- **No forwarding** — the bot can't receive forwarded articles/files; send a link or a file message instead
- **Privacy & security** — messages live only in your vault; only the QR-scanning account is accepted

---

## 中文说明

> 微信 ↔ Obsidian 双向桥接插件:收消息自动入 vault,agent 往发件箱丢个文件就能给你发微信。走腾讯官方 ilink 机器人网关。

**Wechatian** 通过腾讯官方 ilink 机器人网关,把微信变成 vault 的双向通道:

- **收**:消息实时写入每日对话笔记(收发同一时间线);媒体解密存 `attachments/`;链接全文抓取成 markdown 文章笔记
- **发**:往 `outbox/` 丢文件——`.md` 作为文本消息发送(**支持 markdown**),图片/视频/文档(≤100MB)作为附件发送
- **Agent**:插件在收件箱目录维护 `Agent.md`,AI 助手读完即学会发件协议;完整指南见 [Agent.md](Agent.md)

安装、快速上手(含"先给 bot 发一条消息解锁发送"一步)、注意事项见上文英文部分。

## License

[MIT](LICENSE)
