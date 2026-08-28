/**
 * Typed wrapper around the vendored SILK decoder (src/vendor/silk.js,
 * silk-wasm v3.7.1, MIT license). The vendor module ships as plain
 * JavaScript — verbatim minified output plus the base64 silk.wasm binary —
 * and is excluded from lint/typecheck; this file is the only typed surface.
 *
 * Two deviations from upstream, both in the vendor file: the silk.wasm
 * binary is inlined (base64) and bootstrapped through wasmBinary instead of
 * a relative fetch (import.meta.url does not exist in a bundled CJS
 * plugin), and the decode() result is wrapped into RIFF/WAVE here.
 */
// @ts-expect-error — untyped vendored JavaScript bundle
import * as silkVendor from '../vendor/silk.js';

interface SilkModule {
  encode(input: ArrayBuffer | ArrayBufferView, sampleRate: number): Promise<{ data: Uint8Array; duration: number }>;
  decode(input: ArrayBuffer | ArrayBufferView, sampleRate: number): Promise<{ data: Uint8Array; duration: number }>;
  isSilk(data: ArrayBuffer | ArrayBufferView): boolean;
}

const silk = silkVendor as SilkModule;

/** Re-exported for the round-trip test (encode SILK in Node, decode it back) */
export function encode(input: ArrayBuffer | ArrayBufferView, sampleRate: number): Promise<{ data: Uint8Array; duration: number }> {
  return silk.encode(input, sampleRate);
}

/** True when the payload carries the "#!SILK" magic header */
export function isSilk(data: ArrayBuffer | ArrayBufferView): boolean {
  return silk.isSilk(data);
}

/** Wrap pcm_s16le samples in a minimal RIFF/WAVE container so vault
 * renderers and media players can play the voice message */
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const n = pcm.length;
  // four-character chunk ids are byte strings, not little-endian integers
  v.setUint32(0, 0x52494646, false); // "RIFF"
  v.setUint32(4, 36 + n, true);
  v.setUint32(8, 0x57415645, false); // "WAVE"
  v.setUint32(12, 0x666d7420, false); // "fmt "
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate (16-bit mono)
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  v.setUint32(36, 0x64617461, false); // "data"
  v.setUint32(40, n, true);
  const out = new Uint8Array(44 + n);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

/**
 * Decode a WeChat SILK voice message into playable WAV bytes. Tries 24kHz
 * first (the rate the gateway itself transcodes voice to), then 16kHz
 * (SILK's native decode rate). Returns null when neither rate yields audio —
 * the caller falls back to keeping the raw .silk file.
 */
export async function silkToWav(bytes: ArrayBuffer | ArrayBufferView): Promise<Uint8Array | null> {
  for (const rate of [24000, 16000]) {
    try {
      const { data, duration } = await silk.decode(bytes, rate);
      if (duration > 0 && data.length) return pcmToWav(data, rate);
    } catch {
      /* wrong-rate payloads throw; try the next rate */
    }
  }
  return null;
}
