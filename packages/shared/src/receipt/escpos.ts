import type { PrintLine } from './receipt';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Byte ESC/POS untuk printer thermal 80 mm (font A, 48 kolom). Karakter non-ASCII diganti "?". */
export function encodeEscPos(lines: PrintLine[], opts: { feed?: number; cut?: boolean } = {}): Uint8Array {
  const out: number[] = [ESC, 0x40];
  for (const l of lines) {
    out.push(ESC, 0x61, l.align === 'center' ? 1 : l.align === 'right' ? 2 : 0);
    out.push(ESC, 0x45, l.bold ? 1 : 0);
    out.push(GS, 0x21, l.tall ? 0x01 : 0x00);
    for (const ch of l.text) {
      const c = ch.charCodeAt(0);
      out.push(c >= 0x20 && c < 0x7f ? c : 0x3f);
    }
    out.push(LF);
  }
  out.push(ESC, 0x61, 0, ESC, 0x45, 0, GS, 0x21, 0x00);
  out.push(ESC, 0x64, opts.feed ?? 4);
  if (opts.cut ?? true) out.push(GS, 0x56, 0x42, 0x00);
  return Uint8Array.from(out);
}
