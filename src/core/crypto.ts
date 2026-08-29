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

/**
 * Like encryptEcb, but writes into a caller-owned buffer of exactly the
 * padded size — no intermediate copies. That halves the peak memory for
 * 100MB media uploads (plaintext + ciphertext, instead of plaintext + two
 * ciphertext copies). Encrypts in chunks so the per-call input stays small.
 */
export function encryptEcbInto(plain: Uint8Array, key: Buffer, out: Buffer): void {
  const c = createCipheriv('aes-128-ecb', key, null);
  c.setAutoPadding(true);
  let off = 0;
  const CHUNK = 1 << 20; // 1 MiB — any multiple of the 16-byte block size works
  while (plain.length - off > CHUNK) {
    off += c.update(plain.subarray(off, off + CHUNK)).copy(out, off);
  }
  off += c.update(plain.subarray(off)).copy(out, off);
  c.final().copy(out, off);
}

/**
 * Like decryptEcb, but writes into a caller-owned buffer — no intermediate
 * copies (decryptEcb allocated the update()/final() chunks plus a concat
 * copy, tripling the footprint of a 100MB download). Decrypts in chunks so
 * the per-call input stays small, like encryptEcbInto.
 * Returns the number of bytes written into out; the plaintext is at most
 * cipher.length - 1 bytes (PKCS#7 always strips at least one byte), so a
 * caller-supplied buffer of cipher.length always suffices.
 */
export function decryptEcbInto(cipher: Uint8Array, key: Buffer, out: Buffer): number {
  const d = createDecipheriv('aes-128-ecb', key, null);
  d.setAutoPadding(true);
  let off = 0;
  const CHUNK = 1 << 20; // 1 MiB — any multiple of the 16-byte block size works
  while (cipher.length - off > CHUNK) {
    off += d.update(cipher.subarray(off, off + CHUNK)).copy(out, off);
  }
  off += d.update(cipher.subarray(off)).copy(out, off);
  return off + d.final().copy(out, off);
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

/**
 * MD5 over a (possibly huge) byte buffer. Feeds the hash in 1MiB chunks: the
 * total is identical to a single update(), but a 100MB input no longer blocks
 * the renderer in one several-hundred-millisecond call.
 */
export function md5Hex(b: Uint8Array): string {
  const h = createHash('md5');
  const CHUNK = 1 << 20;
  for (let off = 0; off < b.length; off += CHUNK) {
    h.update(b.subarray(off, Math.min(off + CHUNK, b.length)));
  }
  return h.digest('hex');
}

/** AES-ECB ciphertext size after PKCS#7 padding */
export function ecbPaddedSize(plainLen: number): number {
  if (plainLen < 0) return 0;
  return Math.floor((plainLen + 16) / 16) * 16;
}
