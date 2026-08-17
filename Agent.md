# Wechatian — AI Agent Guide

Wechatian is an Obsidian plugin exposing a **one-to-one WeChat channel**: everything sent goes to the vault owner's own bound WeChat account. This document teaches you (an AI assistant) how to use it. 中文版见文末。

## Sending

Write **one file** into the outbox folder (default `Wechatian/outbox/`; in a live vault, follow the runtime `Agent.md` in the inbox folder for actual paths). **Never call any HTTP API — the file channel is the whole interface; no recipient is ever specified.**

| File you write | What gets sent |
|---|---|
| `notify.md` (any text) | The content verbatim as a text message; **markdown is supported** (headings, lists, bold, code blocks) — keep it within a phone screen or so |
| Image `.jpg/.png/.gif/.webp`, video `.mp4` etc., document `.pdf/.docx/…` (≤100MB) | The file as an attachment |

## Judging the result

The plugin consumes the outbox on its next poll (~30–60 s). Wait about a minute, then check:

- **File gone** = sent; recorded in today's conversation note (media copies kept in `attachments/` and linked)
- **File present** = failed: an `.md` gets a `<!-- Wechatian send failed: ... -->` comment appended; media get a `<name>.wechatian-failed.md` sidecar with the reason

## Receiving replies

Inbound WeChat messages are appended to the daily conversation note `<inbox>/YYYY-MM-DD.md` (default `Wechatian/YYYY-MM-DD.md`): timestamped, marked received/sent, bodies in quote blocks, media as `![[...]]` embeds. Read it to get the user's replies.

## Constraints

The gateway rate-limits proactive sends (a handful per day). Use the channel for **notifications** (task finished, long job done) and **decisions** (send a question with options, the user replies one line) — not for chit-chat.

---

# Wechatian — AI 助理使用指南（中文）

Wechatian 是一个 Obsidian 插件,提供一条**一对一微信通道**:所有消息都发给 vault 主人自己绑定的微信。

## 发送

往发件箱目录写**一个文件**即可(默认 `Wechatian/outbox/`;在已安装插件的 vault 里,以收件箱目录中运行时 `Agent.md` 或插件设置里的实际路径为准)。**不调任何 API,文件通道是唯一接口;不需要也不能指定收件人。**

| 你写的文件 | 效果 |
|---|---|
| `notify.md`(任意文本) | 内容**原样**作为文本消息发送,**支持 markdown 格式**(标题、列表、加粗、代码块)——微信端按格式化文本展示,结构清晰;建议控制在手机一屏内 |
| 图片 `.jpg/.png/.gif/.webp`、视频 `.mp4` 等、文档 `.pdf/.docx/…`(≤100MB) | 作为附件发送 |

## 判定结果

插件在下一轮轮询(约 30–60 秒)消费发件箱。写入后**等约一分钟**再检查:

- **文件被删除** = 发送成功,并记录进当天对话笔记(媒体在 `attachments/` 存副本并链接)
- **文件还在** = 失败:`.md` 末尾追加 `<!-- Wechatian send failed: ... -->` 注释;媒体生成同名 `.wechatian-failed.md` 记录原因

## 接收回复

收到的微信消息追加到当天对话笔记 `<收件箱>/YYYY-MM-DD.md`(默认 `Wechatian/YYYY-MM-DD.md`):按时间排列、标记"接收/发送",消息体在引用块中,媒体为 `![[...]]` 嵌入。读这份笔记即可拿到用户的回复。

## 限制

网关对主动消息限流(约每天数条)。这条通道用于**通知**(任务完成、长任务结束)和**拍板**(把问题和选项发过来,用户回一句),不要当聊天通道。
