/** Self-contained QR encoder (byte mode, ECC M, auto version 1-10); only used to render the login QR code */

const DATA_CODEWORDS_M = [0, 16, 28, 44, 64, 86, 108, 124, 154, 182, 216];
const ECC_LEN_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
// [block count, data codewords per block]
const RS_BLOCKS_M: Array<Array<[number, number]>> = [
  [],
  [[1, 16]],
  [[1, 28]],
  [[1, 44]],
  [[2, 32]],
  [[2, 43]],
  [[4, 27]],
  [[4, 31]],
  [[2, 38], [2, 39]],
  [[3, 36], [2, 37]],
  [[4, 43], [1, 44]],
];
const ALIGN: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  return a && b ? EXP[LOG[a] + LOG[b]] : 0;
}

function polyMul(a: number[], b: number[]): number[] {
  const r = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      r[i + j] ^= gfMul(a[i], b[j]);
    }
  }
  return r;
}

function rsGenPoly(n: number): number[] {
  let poly = [1];
  for (let i = 0; i < n; i++) poly = polyMul(poly, [1, EXP[i]]);
  return poly;
}

function rsEncode(data: number[], eccLen: number): number[] {
  const gen = rsGenPoly(eccLen);
  const msg = new Array<number>(data.length + eccLen).fill(0);
  for (let i = 0; i < data.length; i++) msg[i] = data[i];
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) msg[i + j] ^= gfMul(gen[j], coef);
    }
  }
  return msg.slice(data.length);
}

function pickVersion(byteLen: number): number {
  for (let v = 1; v <= 10; v++) {
    const headerBits = 4 + (v < 10 ? 8 : 16);
    if (headerBits + byteLen * 8 <= DATA_CODEWORDS_M[v] * 8) return v;
  }
  throw new Error('QR content too long (>213 bytes)');
}

function buildCodewords(data: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4); // byte-mode marker
  push(data.length, version < 10 ? 8 : 16);
  for (const b of data) push(b, 8);

  const capacity = DATA_CODEWORDS_M[version] * 8;
  for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0); // terminator
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    codewords.push(b);
  }
  const pads = [0xec, 0x11];
  for (let i = 0; codewords.length < DATA_CODEWORDS_M[version]; i++) {
    codewords.push(pads[i % 2]);
  }
  return codewords;
}

function interleave(codewords: number[], version: number): number[] {
  const blocks = RS_BLOCKS_M[version];
  const eccLen = ECC_LEN_M[version];
  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];
  let offset = 0;
  for (const [count, perBlock] of blocks) {
    for (let i = 0; i < count; i++) {
      const data = codewords.slice(offset, offset + perBlock);
      offset += perBlock;
      dataBlocks.push(data);
      eccBlocks.push(rsEncode(data, eccLen));
    }
  }
  const out: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const b of dataBlocks) if (i < b.length) out.push(b[i]);
  }
  for (let i = 0; i < eccLen; i++) {
    for (const b of eccBlocks) out.push(b[i]);
  }
  return out;
}

const MASK_FNS = [
  (r: number, c: number) => (r + c) % 2 === 0,
  (r: number) => r % 2 === 0,
  (_r: number, c: number) => c % 3 === 0,
  (r: number, c: number) => (r + c) % 3 === 0,
  (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r: number, c: number) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r: number, c: number) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r: number, c: number) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function bch15(data5: number): number {
  let v = data5 << 10;
  for (let i = 14; i >= 10; i--) {
    if (v & (1 << i)) v ^= 0x537 << (i - 10);
  }
  return ((data5 << 10) | v) ^ 0x5412;
}

function bch18(v6: number): number {
  let v = v6 << 12;
  for (let i = 17; i >= 12; i--) {
    if (v & (1 << i)) v ^= 0x1f25 << (i - 12);
  }
  return (v6 << 12) | v;
}

class Matrix {
  size: number;
  m: Int8Array; // -1 = unset
  func: Uint8Array; // 1 = function area

  constructor(version: number) {
    this.size = version * 4 + 17;
    this.m = new Int8Array(this.size * this.size).fill(-1);
    this.func = new Uint8Array(this.size * this.size);
  }

  idx(r: number, c: number): number {
    return r * this.size + c;
  }

  set(r: number, c: number, v: number, isFunc = true): void {
    this.m[this.idx(r, c)] = v;
    if (isFunc) this.func[this.idx(r, c)] = 1;
  }

  setupPatterns(version: number): void {
    const n = this.size;
    // finder patterns + separator ring
    const finder = (r0: number, c0: number) => {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const rr = r0 + r;
          const cc = c0 + c;
          if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
          const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6;
          const dark = inRing && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
          this.set(rr, cc, dark ? 1 : 0);
        }
      }
    };
    finder(0, 0);
    finder(n - 7, 0);
    finder(0, n - 7);

    // timing patterns
    for (let i = 8; i < n - 8; i++) {
      this.set(6, i, i % 2 === 0 ? 1 : 0);
      this.set(i, 6, i % 2 === 0 ? 1 : 0);
    }

    // alignment patterns
    const pos = ALIGN[version];
    for (const r of pos) {
      for (const c of pos) {
        if (this.func[this.idx(r, c)]) continue; // skip if overlapping a finder pattern
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            this.set(r + dr, c + dc, dark ? 1 : 0);
          }
        }
      }
    }

    // reserve the format area
    for (let i = 0; i < 9; i++) {
      if (this.m[this.idx(8, i)] === -1) this.set(8, i, 0);
      if (this.m[this.idx(i, 8)] === -1) this.set(i, 8, 0);
    }
    for (let i = 0; i < 8; i++) {
      this.set(8, n - 1 - i, 0);
      this.set(n - 1 - i, 8, 0);
    }
    // fixed dark module
    this.set(n - 8, 8, 1);

    // reserve the version area (v7+)
    if (version >= 7) {
      for (let i = 0; i < 18; i++) {
        const r = Math.floor(i / 3);
        const c = (i % 3) + n - 11;
        this.set(r, c, 0);
        this.set(c, r, 0);
      }
    }
  }

  placeData(bits: number[]): void {
    const n = this.size;
    let bitIdx = 0;
    let upward = true;
    for (let col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (let i = 0; i < n; i++) {
        const row = upward ? n - 1 - i : i;
        for (let k = 0; k < 2; k++) {
          const cc = col - k;
          const id = this.idx(row, cc);
          if (this.func[id]) continue;
          this.m[id] = bitIdx < bits.length ? bits[bitIdx] : 0;
          bitIdx++;
        }
      }
      upward = !upward;
    }
  }

  applyMask(mask: number): void {
    const fn = MASK_FNS[mask];
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const id = this.idx(r, c);
        if (!this.func[id] && fn(r, c)) this.m[id] ^= 1;
      }
    }
  }

  placeFormat(mask: number): void {
    const n = this.size;
    const fmt = bch15((0b00 << 3) | mask); // ECC level M = 00
    for (let i = 0; i < 15; i++) {
      const bit = (fmt >> i) & 1;
      // copy A (top-left)
      if (i < 6) this.set(i, 8, bit);
      else if (i === 6) this.set(7, 8, bit);
      else if (i === 7) this.set(8, 8, bit);
      else if (i === 8) this.set(8, 7, bit);
      else this.set(8, 14 - i, bit);
      // copy B
      if (i < 8) this.set(8, n - 1 - i, bit);
      else this.set(n - 15 + i, 8, bit);
    }
  }

  placeVersion(version: number): void {
    if (version < 7) return;
    const n = this.size;
    const v = bch18(version);
    for (let i = 0; i < 18; i++) {
      const bit = (v >> i) & 1;
      const r = Math.floor(i / 3);
      const c = (i % 3) + n - 11;
      this.set(r, c, bit);
      this.set(c, r, bit);
    }
  }

  penalty(): number {
    const n = this.size;
    const at = (r: number, c: number) => this.m[this.idx(r, c)];
    let score = 0;

    // Rule 1: runs of the same color in a row/column
    for (let r = 0; r < n; r++) {
      let run = 1;
      for (let c = 1; c <= n; c++) {
        if (c < n && at(r, c) === at(r, c - 1)) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
    }
    for (let c = 0; c < n; c++) {
      let run = 1;
      for (let r = 1; r <= n; r++) {
        if (r < n && at(r, c) === at(r - 1, c)) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
    }

    // Rule 2: 2x2 same-color blocks
    for (let r = 0; r < n - 1; r++) {
      for (let c = 0; c < n - 1; c++) {
        const v = at(r, c);
        if (at(r, c + 1) === v && at(r + 1, c) === v && at(r + 1, c + 1) === v) score += 3;
      }
    }

    // Rule 3: the 1011101 + 0000 pattern
    const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const matchPat = (get: (i: number) => number, len: number) => {
      for (let i = 0; i + 11 <= len; i++) {
        let m1 = true;
        let m2 = true;
        for (let j = 0; j < 11; j++) {
          const v = get(i + j);
          if (v !== pat1[j]) m1 = false;
          if (v !== pat2[j]) m2 = false;
          if (!m1 && !m2) break;
        }
        if (m1 || m2) score += 40;
      }
    };
    for (let r = 0; r < n; r++) matchPat((i) => at(r, i), n);
    for (let c = 0; c < n; c++) matchPat((i) => at(i, c), n);

    // Rule 4: dark-module ratio
    let dark = 0;
    for (let i = 0; i < n * n; i++) if (this.m[i] === 1) dark++;
    const pct = (dark * 100) / (n * n);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;

    return score;
  }

  cloneFrom(other: Matrix): void {
    this.m.set(other.m);
    this.func.set(other.func);
  }
}

export interface QrRender {
  size: number;
  isDark(r: number, c: number): boolean;
}

/** Encode a string into a QR matrix (ECC M, auto version and mask selection) */
export function encodeQr(text: string): QrRender {
  const data = new TextEncoder().encode(text);
  const version = pickVersion(data.length);
  const codewords = interleave(buildCodewords(data, version), version);
  const bits: number[] = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  }

  const base = new Matrix(version);
  base.setupPatterns(version);
  base.placeData(bits);
  base.placeVersion(version);

  // pick the best mask
  let bestMask = 0;
  let bestScore = Infinity;
  const trial = new Matrix(version);
  for (let mask = 0; mask < 8; mask++) {
    trial.cloneFrom(base);
    trial.applyMask(mask);
    trial.placeFormat(mask);
    const s = trial.penalty();
    if (s < bestScore) {
      bestScore = s;
      bestMask = mask;
    }
  }

  base.applyMask(bestMask);
  base.placeFormat(bestMask);

  const size = base.size;
  return {
    size,
    isDark: (r: number, c: number) => base.m[r * size + c] === 1,
  };
}
