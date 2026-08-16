/** QR code login flow */
import type { HttpTransport } from './http';
import { bodyJson } from './http';
import type { QrCodeResult, QrStatusResult } from './types';
import { t } from '../i18n';

const QR_POLL_TIMEOUT = 35_000;
const QR_PROACTIVE_REFRESH_AT = 80_000; // QR code TTL is ~120s; refresh proactively at 80s
const MAX_REFRESH = 3;

export interface LoginOutcome {
  token: string;
  botId: string;
  baseUrl: string;
  scannedUser: string;
}

/** Fetch the login QR code */
export async function fetchBotQrCode(transport: HttpTransport, apiBase: string): Promise<QrCodeResult> {
  const u = `${apiBase.replace(/\/$/, '')}/ilink/bot/get_bot_qrcode?bot_type=3`;
  const resp = await transport.get(u, {}, 20_000);
  if (resp.status !== 200) throw new Error(`get_bot_qrcode http ${resp.status}`);
  const out = await bodyJson<QrCodeResult>(resp);
  if (!out.qrcode || !out.qrcode_img_content) {
    throw new Error(t('qr.missingInResponse', { resp: JSON.stringify(out).slice(0, 200) }));
  }
  return out;
}

/** Single scan-status query; network timeouts are treated as still waiting */
export async function pollQrStatus(transport: HttpTransport, apiBase: string, qrKey: string): Promise<QrStatusResult> {
  const u = `${apiBase.replace(/\/$/, '')}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrKey)}`;
  try {
    const resp = await transport.get(u, { 'iLink-App-ClientVersion': '1' }, QR_POLL_TIMEOUT + 5000);
    if (resp.status !== 200) throw new Error(`get_qrcode_status http ${resp.status}`);
    return await bodyJson<QrStatusResult>(resp);
  } catch (e) {
    if ((e as { timeout?: boolean }).timeout) return { status: 'wait' };
    throw e;
  }
}

export interface LoginCallbacks {
  /** Called when the QR code is ready/refreshed (for rendering) */
  onQr(qrUrl: string): void;
  /** Scanned, awaiting confirmation */
  onScanned(): void;
  /** Error notice */
  onError(msg: string): void;
  /** Whether the flow should abort (modal closed / pane switched, etc.) */
  cancelled(): boolean;
}

/**
 * Full scan-login loop: fetch code -> poll -> auto-refresh on expiry (up to 3 times)
 * -> on confirm, obtain the token. Shared by the modal and the settings page.
 * Returns the login outcome on success; null on timeout/cancel.
 */
export async function loginLoop(
  transport: HttpTransport,
  apiBase: string,
  cb: LoginCallbacks,
  timeoutMs = 480_000,
): Promise<LoginOutcome | null> {
  const deadline = Date.now() + timeoutMs;

  const fetchQr = async (): Promise<{ qrKey: string; qrUrl: string }> => {
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

    // Proactively refresh before the estimated expiry
    if (Date.now() - fetchedAt > QR_PROACTIVE_REFRESH_AT && refreshCount < MAX_REFRESH) {
      refreshCount++;
      try {
        cur = await fetchQr();
        fetchedAt = Date.now();
        scannedPrinted = false;
      } catch (e) {
        cb.onError(t('qr.refreshFailed', { err: String((e as Error)?.message ?? e) }));
        await sleep(1000);
        continue;
      }
    }

    let st: QrStatusResult;
    try {
      st = await pollQrStatus(transport, apiBase, cur.qrKey);
    } catch (e) {
      cb.onError(t('qr.queryFailed', { err: String((e as Error)?.message ?? e) }));
      await sleep(1000);
      continue;
    }
    if (cb.cancelled()) return null;

    switch (st.status) {
      case 'wait':
      case '':
        await sleep(200);
        break;
      case 'scaned':
        if (!scannedPrinted) {
          scannedPrinted = true;
          cb.onScanned();
        }
        await sleep(300);
        break;
      case 'expired': {
        refreshCount++;
        if (refreshCount > MAX_REFRESH) {
          cb.onError(t('qr.expiredMultiple'));
          return null;
        }
        try {
          cur = await fetchQr();
          fetchedAt = Date.now();
          scannedPrinted = false;
        } catch (e) {
          cb.onError(t('qr.refreshFailed', { err: String((e as Error)?.message ?? e) }));
          await sleep(1000);
        }
        break;
      }
      case 'confirmed': {
        const botId = (st.ilink_bot_id ?? '').trim();
        const token = (st.bot_token ?? '').trim();
        if (!botId || !token) {
          cb.onError(t('qr.confirmMissingCreds'));
          return null;
        }
        return {
          token,
          botId,
          baseUrl: (st.baseurl ?? '').trim(),
          scannedUser: (st.ilink_user_id ?? '').trim(),
        };
      }
      default:
        await sleep(500);
    }
  }
  cb.onError(t('qr.timeout'));
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
