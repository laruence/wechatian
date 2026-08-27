/** <inbox>/Agent.md: instructions for AI agents on how to use the outbox channel */
import type { App } from 'obsidian';
import type { WechatianSettings } from '../settings';
import { ensureFolder } from './importer';

/** Bump whenever the guide template content changes, so already-installed vaults regenerate their Agent.md */
const GUIDE_REV = '2';

/** Generation fingerprint of an Agent.md: regenerated whenever the language, rev or any path changes */
export function agentGuideMeta(content: string): { lang: string; paths: string; rev: string } {
  const fm = /^---\s*\n([\s\S]*?)\n---/.exec(content)?.[1] ?? '';
  const lang = /lang:\s*"?(\w+)"?/.exec(fm)?.[1] ?? '';
  const paths = /paths:\s*"([^"]*)"/.exec(fm)?.[1] ?? '';
  const rev = /rev:\s*"?(\w+)"?/.exec(fm)?.[1] ?? '';
  return { lang, paths, rev };
}

function pathsKey(s: WechatianSettings): string {
  return [s.inboxFolder, s.outboxFolder, s.attachmentFolder].join('|');
}

function buildEn(s: WechatianSettings): string {
  return `---
lang: en
rev: ${GUIDE_REV}
paths: "${pathsKey(s)}"
---

# WeChat Send (Wechatian)

This Obsidian vault runs the Wechatian plugin, which exposes a one-to-one WeChat channel: every message goes to the vault owner's own bound WeChat account.

## Sending

Write a file into the outbox folder \`${s.outboxFolder}/\`:

- \`.md\` file: the content is sent verbatim as a text message — **markdown is supported** (headings, lists, bold, code blocks); keep it within a phone screen or so (the file name carries no meaning)
- Image (\`.jpg/.png/.gif/.webp\`), video (\`.mp4\` etc.) or document (\`.pdf/.docx/...\`, ≤100MB): sent as an attachment

The plugin consumes the outbox on its next poll (~30-60 s). A successful send deletes the file and records the message in today's conversation note under \`${s.inboxFolder}/\` (marked "sent"; media sends keep a copy under \`${s.attachmentFolder}/\` and link it from the note). A failure keeps the file (an \`.md\` gets a \`<!-- Wechatian send failed: ... -->\` comment appended, a media file gets a \`<name>.wechatian-failed.md\` sidecar). After writing, wait about a minute and check whether the file still exists to determine the result.

## Receiving

Inbound WeChat messages are appended to the same daily conversation notes under \`${s.inboxFolder}/\` (marked "received"); media arrives under \`${s.attachmentFolder}/\`.

## Constraints

The gateway rate-limits proactive sends. Use this channel for notifications (task finished, long job done), not for conversation.
`;
}

function buildZh(s: WechatianSettings): string {
  return `---
lang: zh
rev: ${GUIDE_REV}
paths: "${pathsKey(s)}"
---

# 微信发送(Wechatian)

本 vault 装了 Wechatian 插件,提供一条一对一微信通道:所有消息都发给 vault 主人自己绑定的微信。

## 发送

往发件箱目录 \`${s.outboxFolder}/\` 写一个文件:

- \`.md\` 文件:内容**原样**作为文本消息发送,**支持 markdown 格式**(标题、列表、加粗、代码块),建议控制在手机一屏内(文件名无语义)
- 图片(\`.jpg/.png/.gif/.webp\`)、视频(\`.mp4\` 等)或文档(\`.pdf/.docx/...\`,≤100MB):作为附件发送

插件在下一轮轮询(约 30-60 秒)消费发件箱。发送成功会删除文件,并把这条消息记录进 \`${s.inboxFolder}/\` 下当天的对话笔记(标记"发送";媒体发送会在 \`${s.attachmentFolder}/\` 存一份副本并在笔记里链接)。失败会保留文件(\`.md\` 末尾追加 \`<!-- Wechatian send failed: ... -->\` 注释,媒体文件生成 \`<文件名>.wechatian-failed.md\` 记录)。写入后等约一分钟,检查文件是否还在以判断结果。

## 接收

收到的微信消息追加到同一份每日对话笔记 \`${s.inboxFolder}/\`(标记"接收"),媒体附件保存在 \`${s.attachmentFolder}/\`。

## 限制

网关对主动消息有限流。用于通知(任务完成、长任务结束),不要当聊天通道。
`;
}

function buildTw(s: WechatianSettings): string {
  return `---
lang: tw
rev: ${GUIDE_REV}
paths: "${pathsKey(s)}"
---

# 微信發送(Wechatian)

本 vault 裝了 Wechatian 外掛,提供一條一對一微信通道:所有訊息都發給 vault 主人自己綁定的微信。

## 發送

往發件匣目錄 \`${s.outboxFolder}/\` 寫一個檔案:

- \`.md\` 檔案:內容**原樣**作為文字訊息發送,**支援 markdown 格式**(標題、列表、加粗、程式碼區塊),建議控制在手機一屏內(檔名無語義)
- 圖片(\`.jpg/.png/.gif/.webp\`)、影片(\`.mp4\` 等)或文件(\`.pdf/.docx/...\`,≤100MB):作為附件發送

外掛在下一輪輪詢(約 30-60 秒)消費發件匣。發送成功會刪除檔案,並把這條訊息記錄進 \`${s.inboxFolder}/\` 下當天的對話筆記(標記"發送";媒體發送會在 \`${s.attachmentFolder}/\` 存一份副本並在筆記裡連結)。失敗會保留檔案(\`.md\` 末尾追加 \`<!-- Wechatian send failed: ... -->\` 註解,媒體檔案產生 \`<檔名>.wechatian-failed.md\` 記錄)。寫入後等約一分鐘,檢查檔案是否還在以判斷結果。

## 接收

收到的微信訊息附加到同一份每日對話筆記 \`${s.inboxFolder}/\`(標記"接收"),媒體附件儲存在 \`${s.attachmentFolder}/\`。

## 限制

閘道器對主動訊息有限流。用於通知(任務完成、長任務結束),不要當聊天通道。
`;
}

/**
 * (Re)generate <inbox>/Agent.md. Rewrites whenever the UI language or any of the
 * directory settings changed since the file was generated; user edits made while
 * both stay the same are preserved.
 */
export async function ensureAgentGuide(app: App, s: WechatianSettings, lang: 'en' | 'zh' | 'tw'): Promise<void> {
  const path = `${s.inboxFolder}/Agent.md`;
  const target = lang === 'zh' ? buildZh(s) : lang === 'tw' ? buildTw(s) : buildEn(s);
  try {
    if (await app.vault.adapter.exists(path)) {
      const cur = agentGuideMeta(await app.vault.adapter.read(path));
      if (cur.lang === lang && cur.rev === GUIDE_REV && cur.paths === pathsKey(s)) return;
    } else {
      await ensureFolder(app, s.inboxFolder);
    }
    await app.vault.adapter.write(path, target);
  } catch {
    /* a missing guide is cosmetic; never break startup */
  }
}
