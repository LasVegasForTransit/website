const VERSION = 5;
const SIZE = VERSION * 4 + 17;
const DATA_CODEWORDS = 86;
const BLOCK_COUNT = 2;
const DATA_CODEWORDS_PER_BLOCK = 43;
const ECC_CODEWORDS_PER_BLOCK = 24;
// Format info for error-correction level M with mask pattern 0 — the only
// configuration this generator emits, so the BCH(15, 5) codeword is constant.
const FORMAT_BITS = 0x5412;
const PAD_CODEWORDS = [0xec, 0x11] as const;

type Matrix = boolean[][];

function blankMatrix(): Matrix {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => false));
}

class BitBuffer {
  bits: number[] = [];

  append(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) {
      this.bits.push((value >>> i) & 1);
    }
  }
}

function drawFinder(modules: Matrix, reserved: Matrix, x: number, y: number): void {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || xx >= SIZE || yy < 0 || yy >= SIZE) continue;

      const isRing = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      const isDark =
        isRing &&
        (dx === 0 ||
          dx === 6 ||
          dy === 0 ||
          dy === 6 ||
          (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      modules[yy][xx] = isDark;
      reserved[yy][xx] = true;
    }
  }
}

function drawAlignment(modules: Matrix, reserved: Matrix, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const xx = cx + dx;
      const yy = cy + dy;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      modules[yy][xx] = dist !== 1;
      reserved[yy][xx] = true;
    }
  }
}

function drawFunctionPatterns(modules: Matrix, reserved: Matrix): void {
  drawFinder(modules, reserved, 0, 0);
  drawFinder(modules, reserved, SIZE - 7, 0);
  drawFinder(modules, reserved, 0, SIZE - 7);
  drawAlignment(modules, reserved, 30, 30);

  for (let i = 0; i < SIZE; i += 1) {
    if (!reserved[6][i]) {
      modules[6][i] = i % 2 === 0;
      reserved[6][i] = true;
    }
    if (!reserved[i][6]) {
      modules[i][6] = i % 2 === 0;
      reserved[i][6] = true;
    }
  }

  modules[SIZE - 8][8] = true;
  reserved[SIZE - 8][8] = true;

  for (let i = 0; i < 9; i += 1) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  for (let i = SIZE - 8; i < SIZE; i += 1) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
}

function encodeData(text: string): number[] {
  const bytes = [...new TextEncoder().encode(text)];
  if (bytes.length > 84) {
    throw new Error(`QR destination is too long for the presenter deck: ${text}`);
  }

  const buffer = new BitBuffer();
  buffer.append(0b0100, 4);
  buffer.append(bytes.length, 8);
  for (const byte of bytes) buffer.append(byte, 8);

  const capacityBits = DATA_CODEWORDS * 8;
  buffer.append(0, Math.min(4, capacityBits - buffer.bits.length));
  while (buffer.bits.length % 8 !== 0) buffer.bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < buffer.bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | buffer.bits[i + j];
    codewords.push(value);
  }

  for (let i = 0; codewords.length < DATA_CODEWORDS; i += 1) {
    codewords.push(PAD_CODEWORDS[i % 2]);
  }

  return codewords;
}

function gfMultiply(x: number, y: number): number {
  let product = 0;
  for (let i = 7; i >= 0; i -= 1) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d);
    product ^= ((y >>> i) & 1) * x;
  }
  return product & 0xff;
}

function reedSolomonDivisor(degree: number): number[] {
  const result = Array.from({ length: degree }, () => 0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data: number[], divisor: number[]): number[] {
  const result = Array.from({ length: divisor.length }, () => 0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i] ^= gfMultiply(coefficient, factor);
    });
  }
  return result;
}

function interleaveCodewords(data: number[]): number[] {
  const divisor = reedSolomonDivisor(ECC_CODEWORDS_PER_BLOCK);
  const blocks = Array.from({ length: BLOCK_COUNT }, (_, i) =>
    data.slice(i * DATA_CODEWORDS_PER_BLOCK, (i + 1) * DATA_CODEWORDS_PER_BLOCK),
  );
  const errorBlocks = blocks.map((block) => reedSolomonRemainder(block, divisor));
  const result: number[] = [];

  for (let i = 0; i < DATA_CODEWORDS_PER_BLOCK; i += 1) {
    for (const block of blocks) result.push(block[i]);
  }
  for (let i = 0; i < ECC_CODEWORDS_PER_BLOCK; i += 1) {
    for (const block of errorBlocks) result.push(block[i]);
  }

  return result;
}

function maskBit(x: number, y: number): boolean {
  return (x + y) % 2 === 0;
}

function drawData(modules: Matrix, reserved: Matrix, codewords: number[]): void {
  const bits = codewords.flatMap((codeword) =>
    Array.from({ length: 8 }, (_, i) => (codeword >>> (7 - i)) & 1),
  );
  let bitIndex = 0;
  let upward = true;

  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vert = 0; vert < SIZE; vert += 1) {
      const y = upward ? SIZE - 1 - vert : vert;
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        if (reserved[y][x]) continue;

        const bit = bitIndex < bits.length ? bits[bitIndex] === 1 : false;
        modules[y][x] = bit !== maskBit(x, y);
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

function drawFormatBits(modules: Matrix): void {
  const bitAt = (i: number) => ((FORMAT_BITS >>> i) & 1) === 1;

  for (let i = 0; i <= 5; i += 1) modules[i][8] = bitAt(i);
  modules[7][8] = bitAt(6);
  modules[8][8] = bitAt(7);
  modules[8][7] = bitAt(8);
  for (let i = 9; i < 15; i += 1) modules[8][14 - i] = bitAt(i);

  for (let i = 0; i < 8; i += 1) modules[8][SIZE - 1 - i] = bitAt(i);
  for (let i = 8; i < 15; i += 1) modules[SIZE - 15 + i][8] = bitAt(i);
}

function qrMatrix(text: string): Matrix {
  const modules = blankMatrix();
  const reserved = blankMatrix();
  drawFunctionPatterns(modules, reserved);
  drawData(modules, reserved, interleaveCodewords(encodeData(text)));
  drawFormatBits(modules);
  return modules;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function qrSvg(text: string): string {
  const quiet = 4;
  const viewBoxSize = SIZE + quiet * 2;
  const rects = qrMatrix(text)
    .flatMap((row, y) =>
      row.map((dark, x) =>
        dark ? `<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>` : '',
      ),
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QR code for ${escapeHtml(text)}" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" shape-rendering="crispEdges"><rect width="${viewBoxSize}" height="${viewBoxSize}" fill="#f7f4ec"/><g fill="#0f1115">${rects}</g></svg>`;
}
