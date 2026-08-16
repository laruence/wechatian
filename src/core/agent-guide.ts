/** <inbox>/Agent.md: instructions for AI agents on how to use the outbox channel */
import type { App } from 'obsidian';
import type { WechatianSettings } from '../settings';
import { ensureFolder } from './importer';

/** Generation fingerprint of an Agent.md: regenerated whenever the language or any path changes */
export function agentGuideMeta(content: string): { lang: string; paths: string } {
  const fm = /^---\s*\n([\s\S]*?)\n---/.exec(content)?.[1] ?? '';
  const lang = /lang:\s*"?(\w+)"?/.exec(fm)?.[1] ?? '';
  const paths = /paths:\s*"([^"]*)"/.exec(fm)?.[1] ?? '';
  return { lang, paths };
}

function pathsKey(s: WechatianSettings): string {
  return [s.inboxFolder, s.outboxFolder, s.sentFolder, s.attachmentFolder].join('|');
}

function buildEn(s: WechatianSettings): string {
  return `---
lang: en
paths: "${pathsKey(s)}"
---

# WeChat Send (Wechatian)

This Obsidian vault runs the Wechatian plugin, which exposes a one-to-one WeChat channel: every message goes to the vault owner's own bound WeChat account.

## Sending

Write a file into the outbox folder \`${s.outboxFolder}/\`:

- \`.md\` file: the content is sent as a text message (the file name carries no meaning)
- Image (\`.jpg/.png/.gif/.webp\`), video (\`.mp4\` etc.) or document (\`.pdf/.docx/...\`, ≤100MB): sent as an attachment

The plugin consumes the outbox on its next poll (~30-60 s). A successful send deletes the file and archives a copy under \`${s.sentFolder}/\`; a failure keeps the file (an \`.md\` gets a \`<!-- Wechatian send failed: ... -->\` comment appended, a media file gets a \`<name>.wechatian-failed.md\` sidecar). After writing, wait about a minute and check whether the file still exists to determine the result.

## Receiving

Inbound WeChat messages are appended to daily inbox notes under \`${s.inboxFolder}/\`; media arrives under \`${s.attachmentFolder}/\`.

## Constraints

The gateway rate-limits proactive sends (~4-6 per day). Use this channel for notifications (task finished, long job done), not for conversation.
`;
}

function buildZh(s: WechatianSettings): string {
  return `---
lang: zh
paths: "${pathsKey(s)}"
---

# 微信发送(Wechatian)

本 vault 装了 Wechatian 插件,提供一条一对一微信通道:所有消息都发给 vault 主人自己绑定的微信。

## 发送

往发件箱目录 \`${s.outboxFolder}/\` 写一个文件:

- \`.md\` 文件:内容作为文本消息发送(文件名无语义)
- 图片(\`.jpg/.png/.gif/.webp\`)、视频(\`.mp4\` 等)或文档(\`.pdf/.docx/...\`,≤100MB):作为附件发送

插件在下一轮轮询(约 30-60 秒)消费发件箱。发送成功会删除文件,并在 \`${s.sentFolder}/\` 存档一份副本;失败会保留文件(\`.md\` 末尾追加 \`<!-- Wechatian send failed: ... -->\` 注释,媒体文件生成 \`<文件名>.wechatian-failed.md\` 记录)。写入后等约一分钟,检查文件是否还在以判断结果。

## 接收

收到的微信消息会追加到 \`${s.inboxFolder}/\` 下的每日收件箱笔记,媒体附件保存在 \`${s.attachmentFolder}/\`。

## 限制

网关对主动消息限流(约每天 4-6 条)。用于通知(任务完成、长任务结束),不要当聊天通道。
`;
}

/**
 * (Re)generate <inbox>/Agent.md. Rewrites whenever the UI language or any of the
 * directory settings changed since the file was generated; user edits made while
 * both stay the same are preserved.
 */
export async function ensureAgentGuide(app: App, s: WechatianSettings, lang: 'en' | 'zh'): Promise<void> {
  const path = `${s.inboxFolder}/Agent.md`;
  const target = lang === 'zh' ? buildZh(s) : buildEn(s);
  try {
    if (await app.vault.adapter.exists(path)) {
      const cur = agentGuideMeta(await app.vault.adapter.read(path));
      if (cur.lang === lang && cur.paths === pathsKey(s)) return;
    } else {
      await ensureFolder(app, s.inboxFolder);
    }
    await app.vault.adapter.write(path, target);
  } catch {
    /* a missing guide is cosmetic; never break startup */
  }
}
