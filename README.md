# Wechatian

An [Obsidian](https://obsidian.md) plugin that turns WeChat into a two-way bridge for your vault, through Tencent's official **ilink** bot gateway — no unofficial protocol hacks, no self-hosted relay.

Received messages become daily conversation notes; media and full-text article captures are filed alongside them; and AI agents can message you on WeChat simply by writing a file.

> 微信 ↔ Obsidian 双向桥接插件:收消息自动入 vault,agent 往发件箱丢个文件就能给你发微信。走腾讯官方 ilink 机器人网关。English docs above the Chinese section.

---

## Features

- **Inbox** — incoming WeChat messages are appended to daily conversation notes (`<inbox>/YYYY-MM-DD.md`) in real time via long polling; outbound sends are recorded in the same notes, so each day reads as one conversation
- **Attachments** — images / files / videos / voice are downloaded from the WeChat CDN and decrypted (AES-128-ECB) into `attachments/`
- **Article capture** — links inside messages are fetched in full: the body is converted to markdown and inline images are downloaded into `attachments/`, saved as an article note
- **Outbox** — a file-based send channel: drop an `.md` (sent as text) or an image / video / document ≤100MB (sent as an attachment) into `outbox/`; the plugin encrypts, uploads to the CDN and delivers it to your bound WeChat account
- **Agent-ready** — the plugin maintains an `Agent.md` inside the inbox folder that teaches any AI assistant (Claude, etc.) the outbox protocol
- **QR login** — scan once from the settings page; the plugin binds to the scanning account and only accepts messages from it
- **Bilingual UI** — English / 中文 / follow Obsidian

## Requirements

- Desktop Obsidian 1.13.0+ (long polling; mobile is not supported)
- Node.js 18+ to build from source
- A WeChat account to bind as the bot — a secondary account is recommended

## Install

**From the community store (recommended):** Settings → Community plugins in Obsidian, search for **Wechatian**, install and enable.

**Manually from a release:** download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/laruence/wechatian/releases/latest) into `<vault>/.obsidian/plugins/wechatian/`, then enable **Wechatian** in Obsidian's settings (Settings → Community plugins → reload the plugin list). Release assets are built in CI and carry GitHub artifact attestations:

```bash
gh attestation verify main.js --owner laruence
```

**From source:**

```bash
git clone https://github.com/laruence/wechatian.git
cd wechatian
npm install
npm run build        # bundles main.js and copies it into the vault plugin dir
```

The build also copies the bundle into a vault plugin directory. By default it targets the author's own vault; point it at yours with:

```bash
OBSIDIAN_PLUGIN_DIR=/path/to/vault/.obsidian/plugins/wechatian npm run build
```

After every rebuild, reload the plugin in Obsidian (disable/enable it, or restart) to load the new `main.js`.

**Via AI agent:** point your AI assistant at this repository — https://github.com/laruence/wechatian — and tell it: *"Read this README and install the Wechatian plugin into my Obsidian vault."* The agent should:

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/laruence/wechatian/releases/latest) — verifiable with `gh attestation verify main.js --owner laruence`
2. Place the three files into `<vault>/.obsidian/plugins/wechatian/`
3. Ask you to enable **Wechatian** in Obsidian's settings (Settings → Community plugins)
4. Walk you through QR binding (Quick start below)

## Quick start

1. Open the Wechatian settings page — a QR code appears automatically
2. Scan it with WeChat and confirm on your phone
3. **Send any message to the bot from WeChat** — the gateway only hands out a send credential (context token) once the bound account has messaged the bot; without this step the bot cannot send yet
4. The status bar shows "WeChat online"; incoming messages land in your inbox folder, and the plugin can now send back

## Directory layout

All folders are created automatically when the plugin loads (defaults shown; every path is configurable):

```
Wechatian/
├── Agent.md            # instructions for AI agents (follows UI language)
├── 2026-08-16.md       # daily conversation note (received + sent)
├── attachments/        # received media and sent media copies
├── articles/           # full-text article notes generated from links
└── outbox/             # write a file here to send it
```

## Sending — from agents or scripts

This is a **one-to-one channel**: the bot is bound to the account that scanned the QR code, so everything is delivered to you. No recipient is ever specified.

Write one file into the outbox:

| File you write                 | What gets sent            |
| ------------------------------ | ------------------------- |
| `notify.md` (any text content) | the content as a message  |
| `chart.png`, `report.pdf` …    | the file as an attachment |

The plugin picks it up on the next poll (~30–60 s). Success deletes the file and records the message in today's conversation note (media sends keep a copy in `attachments/` and link it); failure keeps the file with a `<!-- Wechatian send failed: ... -->` note (or a `.wechatian-failed.md` sidecar for media).

Point your agent at `Wechatian/Agent.md` and it learns the whole protocol — that file is maintained by the plugin itself.

## Recipes

**Notify me when a long task finishes.** The agent writes `build-done.md` ("Build finished, 0 errors") into `outbox/`; you get the WeChat push a minute later while you are away from the desk.

**Ask me a decision over WeChat.** The agent writes the question and options into `outbox/ask.md`; you reply on WeChat; the reply lands in today's conversation note (`Wechatian/YYYY-MM-DD.md`), which the agent reads to continue. This turns WeChat into an async approval channel for an unattended session.

**Clip an article.** Send a link from WeChat; the plugin fetches the full body, downloads the inline images, and files a markdown article note under `articles/` — the daily note links to it by title instead of showing the raw URL.

**Send a chart or report.** The agent drops `chart.png` into `outbox/`; it arrives on WeChat as an image message, and a copy is kept in `attachments/` linked from the conversation note.

## For AI assistants

If you are an AI agent working in a vault with Wechatian installed:

1. **Read `<inbox>/Agent.md` first** (default `Wechatian/Agent.md`). The plugin regenerates it whenever folder settings change, so it always documents the current paths and protocol. Do not hard-code paths from this README.
2. **Send** by writing files into the outbox folder (default `Wechatian/outbox/`). Never call any HTTP API — the file channel is the whole interface.
3. **Judge the result** by waiting ~60 s and checking whether your file is still there: gone = sent; present = failed (read the trailing `<!-- ... -->` note or the `.wechatian-failed.md` sidecar for the reason).
4. **Receive replies** by reading today's conversation note (`<inbox>/YYYY-MM-DD.md`). Entries are timestamped and marked received/sent; message bodies are markdown quote blocks; media appear as `![[...]]` embeds.
5. **Respect the rate limit** — the gateway rate-limits proactive sends. Use the channel for notifications and decisions, not chit-chat.

## Good to know

- **First send** — after scanning, message the bot once from WeChat to unlock sending (see Quick start step 3)
- **Privacy** — the plugin talks to the WeChat ilink gateway directly; message content is stored only in your vault
- **Rate limit** — the gateway rate-limits proactive sends; this channel is designed for notifications, not conversations
- **One device per account** — concurrent long polling from multiple devices competes for the same message stream
- **Security** — only messages from the account that scanned the QR code are accepted, so a leaked bot ID alone cannot write into your vault

## Development

```bash
npm install
npm run build      # bundles main.js + the node smoke-test bundle scripts/smoke.js
npm run watch      # rebuild on change
npm run lint       # Obsidian submission checker (eslint-plugin-obsidianmd)
```

**Releasing**: don't build release assets locally. Bump the version in `manifest.json`, `package.json` and `versions.json`, commit, then tag and push — CI builds the assets, signs them with artifact attestations and uploads them to the release:

```bash
git tag x.y.z
git push origin x.y.z
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

- **收**:微信消息实时写入每日对话笔记;图片/文件/视频/语音自动解密存到 `attachments/`;消息里的链接全文抓取(正文转 markdown、图片下载到本地)生成文章笔记,对话笔记里只显示标题链接
- **发**:往 `outbox/` 丢文件——`.md` 作为文本消息发送,图片/视频/文档(≤100MB)作为附件发送;发送成功后记录进当天对话笔记,媒体在 `attachments/` 存副本
- **对话记录**:每天的收与发写在同一份 `<日期>.md` 里,按时间排列、标记接收/发送,消息体在引用块中,是一份可读的双向记录

### 快速上手

1. 打开 Wechatian 设置页,二维码自动出现
2. 用微信扫码,在手机上确认登录
3. **从微信给 bot 发一条任意消息**——网关只在绑定账号给 bot 发过消息后才下发发送凭据(context token),少了这一步 bot 暂时发不出消息
4. 状态栏显示"微信在线":收的消息进收件箱,bot 也具备了发送能力

### 常用场景

- **任务完成微信通知**:agent 往 `outbox/` 写一个 `.md`(如"构建完成,0 错误"),一分钟后你微信收到,人不在电脑前也不漏事
- **分叉点微信拍板**:agent 把问题和选项写进 `outbox/`,你微信上回一句,回复落进当天对话笔记,agent 读取后继续——无人值守会话的异步审批通道
- **文章剪藏**:微信发个链接,vault 里得到全文 markdown 笔记 + 本地化配图
- **发图表/报告**:agent 丢 `chart.png` 进 `outbox/`,微信收到图片,副本留在 `attachments/`

### 给 AI 助手

1. 先读 `<收件箱>/Agent.md`(默认 `Wechatian/Agent.md`)——插件在目录配置变化时自动重写它,路径和协议以它为准,不要照抄本文的默认路径
2. 发送只走发件箱文件,不调任何 API
3. 结果判定:写完后等约 60 秒,文件被删 = 成功;还在 = 失败(读文件末尾注释或 `.wechatian-failed.md` 看原因)
4. 收回复:读当天对话笔记 `<收件箱>/YYYY-MM-DD.md`,条目带时间戳和接收/发送标记
5. 网关对主动消息有限流,用于通知和拍板,别当聊天通道

### 安装

**推荐**:Obsidian 设置 → 第三方插件,搜索 **Wechatian**,安装并启用。

手动安装:从 [最新 release](https://github.com/laruence/wechatian/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css` 三个文件,拷进 `<vault>/.obsidian/plugins/wechatian/` 并在设置里启用(release 资产由 CI 构建并带 GitHub artifact attestation 签名,可用 `gh attestation verify main.js --owner laruence` 验证);或源码构建(`OBSIDIAN_PLUGIN_DIR=<你的vault插件目录> npm run build` 指定目标)。每次重新构建后在 Obsidian 里重载插件。注意:首次扫码绑定后,需先从微信给 bot 发一条任意消息获取发送凭据(见"快速上手"第 3 步),否则 bot 暂时无法主动发送。

**AI 代装**:把仓库地址 https://github.com/laruence/wechatian 交给你的 AI 助手,对它说"阅读这份 README,把 Wechatian 安装到我的 vault 里"。Agent 应当:

1. 从[最新 release](https://github.com/laruence/wechatian/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`(可用 `gh attestation verify main.js --owner laruence` 验证来源)
2. 三个文件放进 `<vault>/.obsidian/plugins/wechatian/`
3. 请你在 Obsidian 设置 → 第三方插件中启用 **Wechatian**
4. 带你完成扫码绑定(见下方"快速上手")

## License

[MIT](LICENSE)
