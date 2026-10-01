import { z, ZodIssueCode, type ZodErrorMap } from 'zod';

const TYPE_NAMES: Record<string, string> = {
  string: 'teks', number: 'angka', integer: 'bilangan bulat', boolean: 'ya/tidak', array: 'daftar', object: 'objek', date: 'tanggal',
};
const typeName = (t: string) => TYPE_NAMES[t] ?? t;
const fmt = (n: number | bigint) => String(n);

/** Pesan validasi Zod dalam Bahasa Indonesia. Pesan khusus di skema tetap diutamakan. */
export const indonesianErrorMap: ZodErrorMap = (issue) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === 'undefined') return { message: 'Wajib diisi' };
      return { message: `Harus berupa ${typeName(issue.expected)}` };
    case ZodIssueCode.too_small: {
      const n = fmt(issue.minimum);
      if (issue.type === 'string') return { message: issue.exact ? `Harus ${n} karakter` : `Minimal ${n} karakter` };
      if (issue.type === 'array' || issue.type === 'set') return { message: issue.exact ? `Harus ${n} item` : `Minimal ${n} item` };
      if (issue.type === 'number' || issue.type === 'bigint') return { message: issue.inclusive ? `Minimal ${n}` : `Harus lebih dari ${n}` };
      return { message: `Nilai terlalu kecil` };
    }
    case ZodIssueCode.too_big: {
      const n = fmt(issue.maximum);
      if (issue.type === 'string') return { message: issue.exact ? `Harus ${n} karakter` : `Maksimal ${n} karakter` };
      if (issue.type === 'array' || issue.type === 'set') return { message: issue.exact ? `Harus ${n} item` : `Maksimal ${n} item` };
      if (issue.type === 'number' || issue.type === 'bigint') return { message: issue.inclusive ? `Maksimal ${n}` : `Harus kurang dari ${n}` };
      return { message: `Nilai terlalu besar` };
    }
    case ZodIssueCode.invalid_string:
      return { message: 'Format tidak valid' };
    case ZodIssueCode.invalid_enum_value:
      return { message: `Pilihan tidak valid. Pilih salah satu: ${issue.options.join(', ')}` };
    case ZodIssueCode.invalid_literal:
      return { message: 'Nilai tidak valid' };
    case ZodIssueCode.unrecognized_keys:
      return { message: `Kolom tidak dikenal: ${issue.keys.join(', ')}` };
    case ZodIssueCode.invalid_date:
      return { message: 'Tanggal tidak valid' };
    case ZodIssueCode.not_multiple_of:
      return { message: `Harus kelipatan ${fmt(issue.multipleOf)}` };
    case ZodIssueCode.not_finite:
      return { message: 'Harus berupa angka yang valid' };
    default:
      return { message: 'Data tidak valid' };
  }
};

let installed = false;
export function installIndonesianZodErrors(): void {
  if (installed) return;
  z.setErrorMap(indonesianErrorMap);
  installed = true;
}
