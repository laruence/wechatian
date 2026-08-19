/** i18n: explicit user choice wins; 'system' follows Obsidian's language */
import { getLanguage as obsidianLanguage } from 'obsidian';

type Dict = Record<string, string>;
export type UiLanguage = 'system' | 'en' | 'zh';

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

  'set.agentGuide': 'Agent 指引',
  'set.agentGuide.desc': '让你的 agent(Claude 等)读取 vault 中的 {{path}},即可学会通过发件箱发送微信消息和附件',
};

function detectDict(): Dict {
  try {
    return obsidianLanguage().toLowerCase().startsWith('zh') ? zh : en;
  } catch {
    return en;
  }
}

let dict: Dict = detectDict();

/** Apply the user's language choice; 'system' re-detects Obsidian's language */
export function applyLanguage(lang: UiLanguage): void {
  dict = lang === 'system' ? detectDict() : lang === 'zh' ? zh : en;
}

/** The concrete dictionary currently in effect ('system' already resolved) */
export function resolvedLanguage(): 'en' | 'zh' {
  return dict === zh ? 'zh' : 'en';
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
