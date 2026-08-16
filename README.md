# Wechatian

An [Obsidian](https://obsidian.md) plugin that turns WeChat into a two-way bridge for your vault — through Tencent's official **ilink** bot gateway, no unofficial protocol hacks, no self-hosted relay.

Messages you receive become daily notes; images, files, voice and articles are filed alongside them; and your AI agents can message you back on WeChat just by writing a file.

> 微信 ↔ Obsidian 双向桥接插件:收消息自动入 vault,agent 往发件箱丢个文件就能给你发微信。走腾讯官方 ilink 机器人网关。English docs above the Chinese section.

---

## Features

- 📥 **Inbox** — incoming WeChat messages are appended to daily notes (`<inbox>/YYYY-MM-DD.md`) in real time via long polling
- 🖼️ **Attachments** — images / files / videos / voice are downloaded from WeChat CDN and decrypted (AES-128-ECB) into `attachments/`
- 📄 **Article notes** — links inside messages are fetched for title & summary and saved as article notes
- 📤 **Outbox** — a file-based send channel: drop an `.md` (sent as text) or an image / video / document ≤100MB (sent as an attachment) into `outbox/`; the plugin encrypts, uploads to CDN and delivers it to your bound WeChat account
- 🗂️ **Sentbox** — every successful send is archived in `sentbox/` so you have a local record
- 🤖 **Agent-ready** — the plugin maintains an `Agent.md` inside the inbox folder that teaches any AI assistant (Claude, etc.) the outbox protocol
- 🔐 **QR login** — scan once from the settings page; the plugin binds to the scanning account and only accepts messages from it
- 🌏 **Bilingual UI** — English / 中文 / follow Obsidian

## Requirements

- **Desktop Obsidian** only (long polling; mobile is not supported)
- A WeChat account to bind as the bot — a secondary account is recommended

## Install

Not on the community plugin store yet — install manually:

```bash
git clone https://github.com/laruence/wechatian.git
cd wechatian
npm install
npm run build        # bundles main.js and copies it into .obsidian/plugins/wechatian/
```

Or copy `main.js`, `manifest.json` and `styles.css` from a release into `<vault>/.obsidian/plugins/wechatian/`. Then enable **Wechatian** in Obsidian's settings.

## Quick start

1. Open the Wechatian settings page — a QR code appears automatically
2. Scan it with WeChat and confirm on your phone
3. The status bar shows `🟢 WeChat online`; incoming messages now land in your inbox folder

## Directory layout

All folders are created automatically when the plugin loads (defaults shown; every path is configurable):

```
Wechatian/
├── Agent.md            # instructions for AI agents (follows UI language)
├── 2026-08-16.md       # daily inbox notes
├── attachments/        # received media
├── articles/           # article notes generated from links
├── outbox/             # ✏️ write a file here to send it
└── sentbox/            # archive of successful sends
```

## Sending — from agents or scripts

This is a **one-to-one channel**: the bot is bound to the account that scanned the QR code, so everything is delivered to you. No recipient is ever specified.

Write one file into the outbox:

| File you write                 | What gets sent            |
| ------------------------------ | ------------------------- |
| `notify.md` (any text content) | the content as a message  |
| `chart.png`, `report.pdf` …    | the file as an attachment |

The plugin picks it up on the next poll (~30–60 s). Success deletes the file and archives a copy in `sentbox/`; failure keeps the file with a `<!-- Wechatian send failed: ... -->` note (or a `.wechatian-failed.md` sidecar for media).

Point your agent at `Wechatian/Agent.md` and it learns the whole protocol — that file is maintained by the plugin itself.

## Good to know

- **Privacy** — the plugin talks to the WeChat ilink gateway directly; message content is stored only in your vault
- **Rate limit** — the gateway throttles proactive sends (roughly 4–6 per day); this channel is designed for notifications, not conversations
- **One device per account** — concurrent long polling from multiple devices competes for the same message stream
- **Security** — only messages from the account that scanned the QR code are accepted, so a leaked bot ID alone cannot write into your vault

## Development

```bash
npm install
npm run build      # bundles main.js + the node smoke-test bundle scripts/smoke.js
npm run watch      # rebuild on change
```

Node smoke tests against the live gateway (`scripts/smoke.js`):

```bash
node scripts/smoke.js qrcode                      # fetch a login QR code
node scripts/smoke.js status <qrkey>              # poll scan status
node scripts/smoke.js poll <token>                # long-poll messages
node scripts/smoke.js send <token> <to> <text>    # send text (env VXBOT_CONTEXT_TOKEN)
node scripts/smoke.js sendfile <token> <to> <f>   # send an attachment
```

---

## 中文说明

**Wechatian** 是一个 Obsidian 插件,通过腾讯官方 ilink 机器人网关把微信变成 vault 的双向通道。

- **收**:微信消息实时写入每日收件箱笔记;图片/文件/视频/语音自动解密存到 `attachments/`;消息里的链接自动抓取标题摘要生成文章笔记
- **发**:往 `outbox/` 丢文件——`.md` 作为文本消息发送,图片/视频/文档(≤100MB)作为附件发送;发送成功后自动存档到 `sentbox/`
- **Agent**:插件在收件箱目录维护一份 `Agent.md`,让你的 AI 助手读完就学会通过发件箱给你发微信
- 扫码登录,一对一通道(只发给扫码绑定的那个账号);仅接受该账号的消息,避免 bot ID 泄露被写入 vault
- 网关对主动消息限流(约每天 4–6 条),适合通知类用途,不适合当聊天通道

## License

[MIT](LICENSE)
