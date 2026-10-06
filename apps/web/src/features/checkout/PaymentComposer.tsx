import { cashPayment, MANUAL_PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentInput, type PaymentMethod } from '@funplay/shared';
import { X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/cn';
import { formatRupiah, parseRupiah } from '../../lib/format';

const QUICK_CASH = [20000, 50000, 100000];

export function PaymentComposer({ remaining, payments, onChange }: { remaining: number; payments: PaymentInput[]; onChange: (p: PaymentInput[]) => void }) {
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');

  const add = (value: number) => {
    if (value <= 0 || remaining <= 0) return;
    const p: PaymentInput = method === 'CASH' ? cashPayment(remaining, value) : { method, amount: Math.min(value, remaining), reference: reference.trim() || null };
    onChange([...payments, p]);
    setAmount('');
    setReference('');
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2">
        {MANUAL_PAYMENT_METHODS.map((m) => (
          <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)}
            className={cn('rounded-xl py-2 text-sm font-bold transition', method === m ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink')}>
            {PAYMENT_METHOD_LABEL[m]}
          </button>
        ))}
      </div>
      <label className="text-sm font-semibold">
        Nominal
        <Input className="mt-1 text-lg" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
      </label>
      {method !== 'CASH' && (
        <label className="text-sm font-semibold">
          Referensi (opsional)
          <Input className="mt-1" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="soft" disabled={remaining <= 0} onClick={() => add(remaining)}>Uang pas</Button>
        {method === 'CASH' && QUICK_CASH.map((v) => (
          <Button key={v} size="sm" variant="soft" disabled={remaining <= 0} onClick={() => add(v)}>{formatRupiah(v)}</Button>
        ))}
      </div>
      <Button variant="soft" disabled={!amount || remaining <= 0} onClick={() => add(parseRupiah(amount))}>Tambah pembayaran</Button>
      {payments.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-xl bg-bg p-2 text-sm">
          {payments.map((p, i) => (
            <li key={i} className="flex items-center justify-between">
              <span>{PAYMENT_METHOD_LABEL[p.method]}{p.reference ? ` · ${p.reference}` : ''}</span>
              <span className="flex items-center gap-2 tabular-nums">
                {formatRupiah(p.received ?? p.amount)}
                <button type="button" aria-label={`Hapus pembayaran ${i + 1}`} onClick={() => onChange(payments.filter((_, j) => j !== i))}><X size={14} /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
