/** CDN media encryption/decryption: AES-128-ECB */
import { createCipheriv, createDecipheriv, createHash } from 'crypto';

/** aes_key: base64(raw 16 bytes) or base64(32-char hex ASCII) -> 16 bytes */
export function parseAesKey(aesKeyBase64: string): Buffer | null {
  try {
    const dec = Buffer.from(aesKeyBase64.trim(), 'base64');
    if (dec.length === 16) return dec;
    if (dec.length === 32) {
      const s = dec.toString('ascii');
      if (/^[0-9a-fA-F]{32}$/.test(s)) return Buffer.from(s, 'hex');
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function decryptEcb(cipher: Buffer, key: Buffer): Buffer {
  const d = createDecipheriv('aes-128-ecb', key, null);
  d.setAutoPadding(true);
  return Buffer.concat([d.update(cipher), d.final()]);
}

export function encryptEcb(plain: Buffer, key: Buffer): Buffer {
  const c = createCipheriv('aes-128-ecb', key, null);
  c.setAutoPadding(true);
  return Buffer.concat([c.update(plain), c.final()]);
}

export function downloadUrl(cdnBase: string, encParam: string): string {
  return `${cdnBase.replace(/\/$/, '')}/download?encrypted_query_param=${encodeURIComponent(encParam)}`;
}

export function detectImageExt(b: Uint8Array): string {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 8 && Buffer.from(b.slice(0, 8)).toString('binary') === '\x89PNG\r\n\x1a\n') return 'png';
  if (b.length >= 6 && ['GIF87a', 'GIF89a'].includes(Buffer.from(b.slice(0, 6)).toString('ascii'))) return 'gif';
  if (b.length >= 12 && Buffer.from(b.slice(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(b.slice(8, 12)).toString('ascii') === 'WEBP') return 'webp';
  return 'jpg';
}

export function md5Hex(b: Uint8Array): string {
  return createHash('md5').update(b).digest('hex');
}

/** AES-ECB ciphertext size after PKCS#7 padding */
export function ecbPaddedSize(plainLen: number): number {
  if (plainLen < 0) return 0;
  return Math.floor((plainLen + 16) / 16) * 16;
}
