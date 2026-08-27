/** i18n: explicit user choice wins; 'system' follows Obsidian's language */
import { getLanguage as obsidianLanguage } from 'obsidian';
import type { ArticleAsset } from './core/types';

type Dict = Record<string, string>;
export type UiLanguage = 'system' | 'en' | 'zh' | 'tw';
export type ResolvedLanguage = 'en' | 'zh' | 'tw';

const en: Dict = {
  'cmd.connect': 'Connect WeChat',
  'cmd.disconnect': 'Disconnect WeChat',
  'cmd.login': 'Re-scan QR code to log in',
  'cmd.inbox': "Open today's inbox",

  'notice.notLoggedIn': 'Wechatian: not logged in — run the command "{{cmd}}"',
  'notice.loggedIn': 'Wechatian: logged in, receiving messages',
  'notice.loggedOut': 'Wechatian: logged out — re-scan in the settings page',
  'notice.sessionExpired': 'Wechatian: WeChat session expired — please re-scan to log in',
  'error.sessionExpired': 'Session expired (-14); please re-scan to log in',
  'notice.importFailed': 'Wechatian: import failed {{err}}',
  'notice.noMsgToday': 'No messages today ({{path}})',
  'notice.prefix': 'WeChat',
  'notice.attachments': '{{n}} attachment(s)',

  'status.disconnected': 'disconnected',
  'status.connecting': 'connecting',
  'status.connected': 'WeChat online',
  'status.expired': 'session expired',
  'status.error': 'connection error',

  'set.language': 'Language',
  'set.language.desc': 'Interface language for settings, commands, and notifications',
  'set.language.system': 'Follow Obsidian',
  'set.autoConnect': 'Auto-connect on startup',
  'set.autoConnect.desc': 'Automatically log in and start receiving WeChat messages when Obsidian launches',
  'set.inboxFolder': 'Inbox folder',
  'set.inboxFolder.desc': 'Folder for the daily message notes',
  'set.attachmentFolder': 'Attachment folder',
  'set.attachmentFolder.desc': 'Folder for images/files/videos/voice messages',
  'set.articleFolder': 'Article folder',
  'set.articleFolder.desc': 'Folder for official-account/web article notes',
  'set.outboxFolder': 'Outbox folder',
  'set.outboxFolder.desc': 'A one-to-one channel to yourself: an agent writes files here — .md sends its content as text, images/videos/documents are sent as attachments — each file is deleted after a successful send',
  'set.autoImport': 'Auto-import messages',
  'set.autoImport.desc': 'Write messages into the inbox as soon as they arrive',
  'set.fetchArticles': 'Fetch article info',
  'set.fetchArticles.desc': 'Automatically fetch the title/summary of links in messages and create article notes',
  'set.groupByAccount': 'Group articles by account',
  'set.groupByAccount.desc': 'Store article notes in a subfolder named after the official account, with its images in an assets subfolder inside it',
  'set.notify': 'Notify on message',
  'set.autoReply': 'Always reply on receipt',
  'set.autoReply.desc': 'After a message is recorded, send a confirmation reply back to WeChat — e.g. where an image or article was saved. May be rate-limited by the gateway if you receive many messages.',
  'set.footer': 'Note: this plugin talks to the WeChat ilink gateway directly; messages are stored only in this vault. Proactive sends are rate-limited by the gateway.',

  'login.status': 'Login status',
  'login.bound': 'Bound · bot {{bot}} · scanning user {{user}}',
  'login.rescan': 'Re-scan',
  'login.logout': 'Log out',
  'login.notLoggedIn': 'Not logged in to WeChat yet. Scan the QR code below to bind:',
  'login.fetching': 'Fetching QR code…',
  'login.waiting': 'Waiting for scan…',
  'login.scanned': 'Scanned — please confirm on your phone…',
  'login.success': 'Logged in',

  'modal.title': 'WeChat Scan Login',
  'modal.hint': 'Scan the QR code below with WeChat, then confirm login on your phone.',
  'modal.renderFailed': 'Failed to render QR code: {{err}}',
  'modal.openLink': 'or tap this link to open on your phone',

  'importer.attachFailed': 'Failed to save attachment: {{name}}',
  'importer.received': 'received',
  'importer.sent': 'sent',
  'importer.source': 'Source',
  'importer.imported': 'Imported',
  'importer.from': 'From',
  'importer.summary': 'Summary',
  'importer.inboxTitle': '{{date}} WeChat Inbox',

  'outbox.failedNote': 'Wechatian send failed: ret={{ret}} {{msg}}',

  'qr.missingInResponse': 'get_bot_qrcode response missing QR code: {{resp}}',
  'qr.refreshFailed': 'Failed to refresh QR code: {{err}}',
  'qr.queryFailed': 'Failed to query scan status: {{err}}',
  'qr.expiredMultiple': 'QR code expired multiple times, please retry',
  'qr.confirmMissingCreds': 'Login confirmed but credentials missing',
  'qr.timeout': 'Timed out waiting for scan, please retry',

  'sendTest.name': 'Test send',
  'sendTest.desc': 'Sends to your own bound WeChat account (one-to-one channel)',
  'sendTest.send': 'Send',
  'sendTest.placeholder': 'Type a message',
  'sendTest.ok': 'Message sent',
  'sendTest.empty': 'Nothing to send',
  'sendTest.failed': 'Send failed: {{err}}',
  'sendTest.notBound': 'Not logged in yet',
  'sendTest.needFirstMessage': 'No send credential yet — send any message to the bot from WeChat first, then retry',

  'reply.done': 'Received and saved',
  'reply.attachment.failed': 'failed to save attachment',
  'reply.article.failed': 'failed to fetch article',
  'reply.recordFailed': 'Message received, but recording it to the vault failed.',

  'err.noToken': 'No send credential yet',
  'err.noToken.hint': 'Replying requires a context token handed out by WeChat: first send any message to the bot from WeChat, then retry.',
  'err.rateLimited': 'Send rejected (rate limit or no permission)',
  'err.rateLimited.hint': 'The gateway rate-limits proactive sends. Wait a few minutes and retry.',
  'err.network': 'Network error',
  'err.network.hint': 'Check the network/connection, then retry.',
  'err.sessionExpired': 'WeChat session expired',
  'err.sessionExpired.hint': 'Re-scan the QR code to log in again, then retry.',
  'err.unknown': 'Send failed: ret={{ret}} {{errmsg}}',
  'err.unknown.hint': 'Check the network and gateway status, then retry.',

  'set.agentGuide': 'Agent guide',
  'set.agentGuide.desc': 'Point your agent (Claude etc.) at {{path}} in the vault — it explains how to send WeChat messages and attachments through the outbox',
};

const zh: Dict = {
  'cmd.connect': '连接微信',
  'cmd.disconnect': '断开微信',
  'cmd.login': '重新扫码登录',
  'cmd.inbox': '打开今日收件箱',

  'notice.notLoggedIn': 'Wechatian:尚未登录,运行命令「{{cmd}}」',
  'notice.loggedIn': 'Wechatian: 登录成功,开始接收消息',
  'notice.loggedOut': 'Wechatian: 已登出,请在设置页重新扫码',
  'notice.sessionExpired': 'Wechatian: 微信会话过期,请重新扫码登录',
  'error.sessionExpired': '会话过期(-14),请重新扫码登录',
  'notice.importFailed': 'Wechatian: 导入失败 {{err}}',
  'notice.noMsgToday': '今日暂无消息({{path}})',
  'notice.prefix': '微信',
  'notice.attachments': '{{n}} 个附件',

  'status.disconnected': '未连接',
  'status.connecting': '连接中',
  'status.connected': '微信在线',
  'status.expired': '会话过期',
  'status.error': '连接错误',

  'set.language': '语言',
  'set.language.desc': '设置页、命令与通知的界面语言',
  'set.language.system': '跟随 Obsidian',
  'set.autoConnect': '启动时自动连接',
  'set.autoConnect.desc': 'Obsidian 启动后自动登录并开始接收微信消息',
  'set.inboxFolder': '收件箱目录',
  'set.inboxFolder.desc': '每日消息笔记存放目录',
  'set.attachmentFolder': '附件目录',
  'set.attachmentFolder.desc': '图片/文件/视频/语音存放目录',
  'set.articleFolder': '文章目录',
  'set.articleFolder.desc': '公众号/网页文章笔记存放目录',
  'set.outboxFolder': '发件箱目录',
  'set.outboxFolder.desc': '给自己的单向通道:agent 在此写入文件,.md 作为文本消息发送,图片/视频/文档作为附件发送,发送成功后删除文件',
  'set.autoImport': '自动导入消息',
  'set.autoImport.desc': '收到消息后立即写入收件箱',
  'set.fetchArticles': '抓取文章信息',
  'set.fetchArticles.desc': '消息里的链接自动抓取标题/摘要并建立文章笔记',
  'set.groupByAccount': '按公众号分目录',
  'set.groupByAccount.desc': '文章笔记存入以公众号命名的子目录,文章配图存到该目录下的 assets 子目录',
  'set.notify': '来消息时通知',
  'set.autoReply': '总是回复',
  'set.autoReply.desc': '消息记录入库后,自动回复一条确认消息(如图片/文章的保存位置)。消息较多时可能触发网关限流。',
  'set.footer': '说明:本插件直接与微信 ilink 网关通信,消息仅保存在本 vault。主动发送受网关限流。',

  'login.status': '登录状态',
  'login.bound': '已绑定 · 机器人 {{bot}} · 扫码用户 {{user}}',
  'login.rescan': '重新扫码',
  'login.logout': '退出登录',
  'login.notLoggedIn': '尚未登录微信。扫描下方二维码绑定:',
  'login.fetching': '正在获取二维码…',
  'login.waiting': '等待扫码…',
  'login.scanned': '已扫码,请在手机上确认…',
  'login.success': '登录成功',

  'modal.title': '微信扫码登录',
  'modal.hint': '用微信扫描下方二维码,然后在手机上确认登录。',
  'modal.renderFailed': '二维码渲染失败: {{err}}',
  'modal.openLink': '或点击此链接在手机打开',

  'importer.attachFailed': '附件保存失败: {{name}}',
  'importer.received': '接收',
  'importer.sent': '发送',
  'importer.source': '来源',
  'importer.imported': '收录时间',
  'importer.from': '发送者',
  'importer.summary': '摘要',
  'importer.inboxTitle': '{{date}} 微信收件箱',

  'outbox.failedNote': 'Wechatian 发送失败: ret={{ret}} {{msg}}',

  'qr.missingInResponse': 'get_bot_qrcode 响应缺少二维码: {{resp}}',
  'qr.refreshFailed': '二维码刷新失败: {{err}}',
  'qr.queryFailed': '查询扫码状态失败: {{err}}',
  'qr.expiredMultiple': '二维码多次过期,请重试',
  'qr.confirmMissingCreds': '登录确认但缺少凭据',
  'qr.timeout': '等待扫码超时,请重试',

  'sendTest.name': '测试发送',
  'sendTest.desc': '发送到你绑定的微信(一对一通道,收件人就是你自己)',
  'sendTest.send': '发送',
  'sendTest.placeholder': '输入要发送的内容',
  'sendTest.ok': '消息已发送',
  'sendTest.empty': '内容为空,没有可发送的消息',
  'sendTest.failed': '发送失败: {{err}}',
  'sendTest.notBound': '尚未登录',
  'sendTest.needFirstMessage': '还没有发送凭据——请先从微信给机器人发一条消息,再重试',

  'reply.done': '收到,已完成保存',
  'reply.attachment.failed': '附件保存失败',
  'reply.article.failed': '文章抓取失败',
  'reply.recordFailed': '消息已收到,但写入 vault 失败。',

  'err.noToken': '还没有发送凭据',
  'err.noToken.hint': '回复需要微信下发的 context token——先从微信给机器人发任意一条消息,再重试。',
  'err.rateLimited': '发送被拒(限流或无权限)',
  'err.rateLimited.hint': '网关对主动发送有限流,稍等几分钟再试。',
  'err.network': '网络错误',
  'err.network.hint': '检查网络/连接后重试。',
  'err.sessionExpired': '微信会话过期',
  'err.sessionExpired.hint': '重新扫码登录后再发送。',
  'err.unknown': '发送失败: ret={{ret}} {{errmsg}}',
  'err.unknown.hint': '检查网络和网关状态后重试。',

  'set.agentGuide': 'Agent 指引',
  'set.agentGuide.desc': '让你的 agent(Claude 等)读取 vault 中的 {{path}},即可学会通过发件箱发送微信消息和附件',
};

const tw: Dict = {
  'cmd.connect': '連接微信',
  'cmd.disconnect': '中斷微信',
  'cmd.login': '重新掃碼登入',
  'cmd.inbox': '開啟今日收件匣',

  'notice.notLoggedIn': 'Wechatian:尚未登入,執行指令「{{cmd}}」',
  'notice.loggedIn': 'Wechatian: 登入成功,開始接收訊息',
  'notice.loggedOut': 'Wechatian: 已登出,請在設定頁重新掃碼',
  'notice.sessionExpired': 'Wechatian: 微信工作階段過期,請重新掃碼登入',
  'error.sessionExpired': '工作階段過期(-14),請重新掃碼登入',
  'notice.importFailed': 'Wechatian: 匯入失敗 {{err}}',
  'notice.noMsgToday': '今日暫無訊息({{path}})',
  'notice.prefix': '微信',
  'notice.attachments': '{{n}} 個附件',

  'status.disconnected': '未連接',
  'status.connecting': '連接中',
  'status.connected': '微信在線',
  'status.expired': '工作階段過期',
  'status.error': '連接錯誤',

  'set.language': '語言',
  'set.language.desc': '設定頁、指令與通知的介面語言',
  'set.language.system': '跟隨 Obsidian',
  'set.autoConnect': '啟動時自動連接',
  'set.autoConnect.desc': 'Obsidian 啟動後自動登入並開始接收微信訊息',
  'set.inboxFolder': '收件匣目錄',
  'set.inboxFolder.desc': '每日訊息筆記存放目錄',
  'set.attachmentFolder': '附件目錄',
  'set.attachmentFolder.desc': '圖片/檔案/影片/語音存放目錄',
  'set.articleFolder': '文章目錄',
  'set.articleFolder.desc': '公眾號/網頁文章筆記存放目錄',
  'set.outboxFolder': '發件匣目錄',
  'set.outboxFolder.desc': '給自己的單向通道:agent 在此寫入檔案,.md 作為文字訊息發送,圖片/影片/文件作為附件發送,發送成功後刪除檔案',
  'set.autoImport': '自動匯入訊息',
  'set.autoImport.desc': '收到訊息後立即寫入收件匣',
  'set.fetchArticles': '抓取文章資訊',
  'set.fetchArticles.desc': '訊息裡的連結自動抓取標題/摘要並建立文章筆記',
  'set.groupByAccount': '依公眾號分目錄',
  'set.groupByAccount.desc': '文章筆記存入以公眾號命名的子目錄,文章配圖存到該目錄下的 assets 子目錄',
  'set.notify': '來訊息時通知',
  'set.autoReply': '總是回覆',
  'set.autoReply.desc': '訊息記錄入庫後,自動回覆一條確認訊息(如圖片/文章的儲存位置)。訊息較多時可能觸發閘道器限流。',
  'set.footer': '說明:本外掛直接與微信 ilink 閘道器通訊,訊息僅儲存在本 vault。主動發送受閘道器限流。',

  'login.status': '登入狀態',
  'login.bound': '已綁定 · 機器人 {{bot}} · 掃碼使用者 {{user}}',
  'login.rescan': '重新掃碼',
  'login.logout': '登出',
  'login.notLoggedIn': '尚未登入微信。掃描下方二維碼綁定:',
  'login.fetching': '正在取得二維碼…',
  'login.waiting': '等待掃碼…',
  'login.scanned': '已掃碼,請在手機上確認…',
  'login.success': '登入成功',

  'modal.title': '微信掃碼登入',
  'modal.hint': '用微信掃描下方二維碼,然後在手機上確認登入。',
  'modal.renderFailed': '二維碼產生失敗: {{err}}',
  'modal.openLink': '或點此連結在手機開啟',

  'importer.attachFailed': '附件儲存失敗: {{name}}',
  'importer.received': '接收',
  'importer.sent': '發送',
  'importer.source': '來源',
  'importer.imported': '收錄時間',
  'importer.from': '發送者',
  'importer.summary': '摘要',
  'importer.inboxTitle': '{{date}} 微信收件匣',

  'outbox.failedNote': 'Wechatian 發送失敗: ret={{ret}} {{msg}}',

  'qr.missingInResponse': 'get_bot_qrcode 回應缺少二維碼: {{resp}}',
  'qr.refreshFailed': '二維碼重新整理失敗: {{err}}',
  'qr.queryFailed': '查詢掃碼狀態失敗: {{err}}',
  'qr.expiredMultiple': '二維碼多次過期,請重試',
  'qr.confirmMissingCreds': '登入確認但缺少憑證',
  'qr.timeout': '等待掃碼逾時,請重試',

  'sendTest.name': '測試發送',
  'sendTest.desc': '發送到你綁定的微信(一對一通道,收件人就是你自己)',
  'sendTest.send': '發送',
  'sendTest.placeholder': '輸入要發送的內容',
  'sendTest.ok': '訊息已發送',
  'sendTest.empty': '內容為空,沒有可發送的訊息',
  'sendTest.failed': '發送失敗: {{err}}',
  'sendTest.notBound': '尚未登入',
  'sendTest.needFirstMessage': '還沒有發送憑證——請先從微信給機器人發一條訊息,再重試',

  'reply.done': '收到,已完成儲存',
  'reply.attachment.failed': '附件儲存失敗',
  'reply.article.failed': '文章抓取失敗',
  'reply.recordFailed': '訊息已收到,但寫入 vault 失敗。',

  'err.noToken': '還沒有發送憑證',
  'err.noToken.hint': '回覆需要微信下發的 context token——請先從微信給機器人發任意一條訊息,再重試。',
  'err.rateLimited': '發送被拒(限流或無權限)',
  'err.rateLimited.hint': '閘道器對主動發送有限流,稍等幾分鐘再試。',
  'err.network': '網路錯誤',
  'err.network.hint': '檢查網路/連線後重試。',
  'err.sessionExpired': '微信工作階段過期',
  'err.sessionExpired.hint': '重新掃碼登入後再發送。',
  'err.unknown': '發送失敗: ret={{ret}} {{errmsg}}',
  'err.unknown.hint': '檢查網路和閘道器狀態後重試。',

  'set.agentGuide': 'Agent 指引',
  'set.agentGuide.desc': '讓你的 agent(Claude 等)讀取 vault 中的 {{path}},即可學會透過發件匣發送微信訊息和附件',
};

function detectDict(): Dict {
  try {
    const lang = obsidianLanguage().toLowerCase();
    if (lang.startsWith('zh')) {
      return lang.includes('tw') || lang.includes('hk') || lang.includes('hant') ? tw : zh;
    }
    return en;
  } catch {
    return en;
  }
}

let dict: Dict = detectDict();

/** Dictionary exports for testing (key parity + language-specific assertions) */
export const dictionaries = { en, zh, tw };

/** Apply the user's language choice; 'system' re-detects Obsidian's language */
export function applyLanguage(lang: UiLanguage): void {
  dict = lang === 'system' ? detectDict() : lang === 'zh' ? zh : lang === 'tw' ? tw : en;
}

/** The concrete dictionary currently in effect ('system' already resolved) */
export function resolvedLanguage(): ResolvedLanguage {
  return dict === zh ? 'zh' : dict === tw ? 'tw' : 'en';
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = dict[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{{${k}}}`, String(v));
    }
  }
  return s;
}

/** Why a send failed — drives the localized reason + fix hint shown to the user */
export type SendFailureCategory = 'noToken' | 'rateLimited' | 'network' | 'sessionExpired' | 'unknown';

export function classifySendFailure(input: {
  ret: number;
  errmsg: string;
  contextToken: string;
}): SendFailureCategory {
  const msg = input.errmsg.toLowerCase();
  if (!input.contextToken.trim() || /context[_ ]?token/.test(msg)) return 'noToken';
  if (msg.includes('session expired') || msg.includes('会话过期') || msg.includes('會話過期')) return 'sessionExpired';
  if (/fetch failed|network|econn|etimedout|socket hang up|abort/.test(msg)) return 'network';
  if (/no permission|permission denied/.test(msg)) return 'rateLimited';
  if (input.ret === -14 || input.ret === -20) return 'sessionExpired';
  if (input.ret !== 0) return 'rateLimited';
  return 'unknown';
}

/** One localized line pair — "reason — how to fix it" — for a failed send */
export function buildSendFailure(errmsg: string, ret: number, contextToken = ''): string {
  const cat = classifySendFailure({ ret, errmsg, contextToken });
  if (cat === 'noToken') return `${t('err.noToken')} — ${t('err.noToken.hint')}`;
  if (cat === 'rateLimited') return `${t('err.rateLimited')} — ${t('err.rateLimited.hint')}`;
  if (cat === 'network') return `${t('err.network')} — ${t('err.network.hint')}`;
  if (cat === 'sessionExpired') return `${t('err.sessionExpired')} — ${t('err.sessionExpired.hint')}`;
  return `${t('err.unknown', { ret: String(ret), errmsg: errmsg.trim() || '?' })} — ${t('err.unknown.hint')}`;
}

/** Summary of one inbound message's import result — feeds the receipt reply */
export interface ReceiptReplyInput {
  ok: boolean; // whether recording into the vault succeeded at all
  appended: boolean; // whether the daily-note append succeeded
  dailyNote: string; // path of the daily conversation note
  attachmentPaths: string[]; // saved attachment paths
  attachmentFailures: string[]; // failed attachments as "name (reason)"
  linkCount: number; // links found in the message text
  articleAssets: ArticleAsset[]; // saved article notes + where their images went
  articleFailures: string[]; // reasons the article notes could not be created
}

/**
 * Assemble the confirmation reply for every message recorded in one polling
 * round. All messages from the same sender go back as ONE WeChat message:
 * one "received and saved" line per recorded message, plus one line per
 * failure with its reason, so the user always sees why something did not
 * land. Pure function so the logic is unit-testable.
 */
export function buildReceiptReplies(results: ReceiptReplyInput[]): string[] {
  const lines: string[] = [];
  for (const r of results) {
    if (!r.ok) {
      lines.push(t('reply.recordFailed'));
      continue;
    }
    lines.push(t('reply.done'));
    for (const f of r.attachmentFailures) lines.push(`${t('reply.attachment.failed')}: ${f}`);
    for (const reason of r.articleFailures) lines.push(`${t('reply.article.failed')}: ${reason}`);
    if (!r.attachmentPaths.length && !r.attachmentFailures.length && r.linkCount && !r.articleAssets.length && !r.articleFailures.length) {
      lines.push(`${t('reply.article.failed')}: unknown`);
    }
  }
  return [lines.join('\n')];
}
