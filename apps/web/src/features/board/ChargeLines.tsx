import type { TimeCharge } from '@funplay/shared';
import { formatMinutes, formatRupiah } from '../../lib/format';

export function ChargeLines({ charge }: { charge: TimeCharge | null }) {
  if (!charge) return <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">Tarif belum diatur untuk jam ini.</p>;
  return (
    <div className="rounded-xl bg-bg p-3 text-sm">
      {charge.lines.map((l, i) => (
        <div key={i} className="flex justify-between py-0.5">
          <span>
            {l.label} · {formatMinutes(l.minutes)}
            {l.fallback && <span className="text-amber-700"> · di luar jam tarif</span>}
          </span>
          <span className="tabular-nums">{formatRupiah(l.amount)}</span>
        </div>
      ))}
      {charge.noTariff && <p className="py-0.5 text-rose-700">Tarif tipe meja ini belum diatur — waktu tidak ditagih.</p>}
      <div className="mt-2 flex justify-between border-t border-line pt-2 text-base font-extrabold text-primary">
        <span>Total waktu</span>
        <span className="tabular-nums">{formatRupiah(charge.total)}</span>
      </div>
    </div>
  );
}
