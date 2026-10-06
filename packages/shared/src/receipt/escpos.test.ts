import { describe, expect, it } from 'vitest';
import { encodeEscPos } from './escpos';

const bytes = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const indexOfSeq = (hay: number[], needle: number[]) => hay.findIndex((_, i) => needle.every((n, j) => hay[i + j] === n));

describe('encodeEscPos', () => {
  const out = Array.from(encodeEscPos([{ text: 'FunPlay', align: 'center', bold: true, tall: true }, { text: 'Café 1' }]));

  it('diawali init dan diakhiri feed + cut', () => {
    expect(out.slice(0, 2)).toEqual([0x1b, 0x40]);
    expect(out.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00]);
    expect(indexOfSeq(out, [0x1b, 0x64, 4])).toBeGreaterThan(0);
  });

  it('mengatur rata tengah, tebal, dan tinggi ganda sebelum teks', () => {
    const at = indexOfSeq(out, bytes('FunPlay'));
    expect(out.slice(at - 9, at)).toEqual([0x1b, 0x61, 1, 0x1b, 0x45, 1, 0x1d, 0x21, 0x01]);
  });

  it('karakter non-ASCII diganti "?"', () => {
    expect(indexOfSeq(out, bytes('Caf? 1'))).toBeGreaterThan(0);
  });

  it('tanpa potong kertas bila cut=false', () => {
    const noCut = Array.from(encodeEscPos([{ text: 'x' }], { cut: false }));
    expect(indexOfSeq(noCut, [0x1d, 0x56])).toBe(-1);
  });
});
