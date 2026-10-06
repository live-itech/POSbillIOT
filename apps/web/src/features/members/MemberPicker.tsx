import type { MemberDto } from '@funplay/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { api } from '../../lib/api';

/** Cari member aktif (kode/nama/HP) lalu pilih. Dipakai di Mulai sesi, Checkout, dan Booking. */
export function MemberPickerDialog({ onPick, onClose }: { onPick: (m: MemberDto) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const term = q.trim();
  const list = useQuery({
    queryKey: ['members', { q: term, active: true }],
    queryFn: () => api<MemberDto[]>('GET', `/members?${new URLSearchParams({ active: 'true', ...(term ? { q: term } : {}) })}`),
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Pilih member">
      <Input aria-label="Cari member" placeholder="Kode, nama, atau no. HP" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto">
        {(list.data ?? []).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              onPick(m);
              onClose();
            }}
            className="flex items-center justify-between rounded-xl border-2 border-line px-3 py-2 text-left text-sm font-semibold hover:border-primary"
          >
            <span>{`${m.code} · ${m.name}${m.phone ? ` · ${m.phone}` : ''}`}</span>
            <span className="text-xs text-muted">{m.levelName}</span>
          </button>
        ))}
        {list.data?.length === 0 && <p className="text-sm text-muted">Member tidak ditemukan.</p>}
      </div>
    </Modal>
  );
}
