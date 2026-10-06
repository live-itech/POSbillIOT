import type { MemberDto } from '@funplay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { showError, toast } from '../../stores/toast';
import { useMe } from '../auth/auth';
import { CrudResource } from '../settings/CrudResource';
import { LEVEL_RESOURCE } from './levels';
import { MemberDialog } from './MemberDialog';

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className={cn('rounded-full px-4 py-1.5 text-sm font-semibold', active ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink')}>
      {children}
    </button>
  );
}

export function MembersPage() {
  const me = useMe().data;
  const [tab, setTab] = useState<'members' | 'levels'>('members');
  if (!me) return null;
  const canEdit = me.role !== 'KASIR';
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <div className="flex gap-2">
        <Tab active={tab === 'members'} onClick={() => setTab('members')}>Member</Tab>
        {canEdit && <Tab active={tab === 'levels'} onClick={() => setTab('levels')}>Level</Tab>}
      </div>
      {tab === 'levels' && canEdit ? <CrudResource config={LEVEL_RESOURCE} /> : <MemberList canEdit={canEdit} />}
    </div>
  );
}

function MemberList({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const term = q.trim();
  const list = useQuery({ queryKey: ['members', { q: term }], queryFn: () => api<MemberDto[]>('GET', `/members${term ? `?q=${encodeURIComponent(term)}` : ''}`) });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemberDto | 'new' | null>(null);
  const selected = (list.data ?? []).find((m) => m.id === selectedId) ?? null;
  const toggle = useMutation({
    mutationFn: (m: MemberDto) => api<MemberDto>('PATCH', `/members/${m.id}`, { active: !m.active }),
    onSuccess: (m) => {
      void qc.invalidateQueries({ queryKey: ['members'] });
      toast.success(m.active ? 'Member diaktifkan' : 'Member dinonaktifkan');
    },
    onError: showError,
  });

  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-[1fr_360px]">
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Input aria-label="Cari member" placeholder="Cari kode, nama, atau no. HP" className="max-w-sm" value={q} onChange={(e) => setQ(e.target.value)} />
          {canEdit && <Button className="ml-auto" onClick={() => setEditing('new')}>+ Member</Button>}
        </div>
        <div className="overflow-x-auto rounded-2xl bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-primary-soft text-left text-primary-ink">
              <tr><th className="p-3">Kode</th><th>Nama</th><th>No. HP</th><th>Level</th><th>Status</th></tr>
            </thead>
            <tbody>
              {(list.data ?? []).map((m) => (
                <tr key={m.id} onClick={() => setSelectedId(m.id)} className={cn('cursor-pointer border-t border-line hover:bg-primary-soft/40', selectedId === m.id && 'bg-primary-soft')}>
                  <td className="p-3 font-mono text-xs">{m.code}</td>
                  <td>{m.name}</td>
                  <td>{m.phone || '—'}</td>
                  <td>{m.levelName}</td>
                  <td>{m.active ? 'Aktif' : 'Nonaktif'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data?.length === 0 && <p className="p-4 text-sm text-muted">Member tidak ditemukan.</p>}
        </div>
      </section>
      <aside>
        {selected ? (
          <section className="flex flex-col gap-2 rounded-2xl bg-surface p-4 shadow-sm">
            <h2 className="text-lg font-extrabold">{selected.name}</h2>
            <p className="text-sm text-muted">{`${selected.code} · ${selected.levelName} · ${selected.active ? 'Aktif' : 'Nonaktif'}`}</p>
            <p className="text-sm">{`No. HP: ${selected.phone || '—'}`}</p>
            {canEdit && (
              <div className="mt-2 flex gap-2">
                <Button variant="soft" onClick={() => setEditing(selected)}>Ubah</Button>
                <Button variant={selected.active ? 'danger' : 'soft'} disabled={toggle.isPending} onClick={() => toggle.mutate(selected)}>
                  {selected.active ? 'Nonaktifkan' : 'Aktifkan'}
                </Button>
              </div>
            )}
          </section>
        ) : (
          <p className="text-sm text-muted">Pilih member untuk melihat detail.</p>
        )}
      </aside>
      {editing && <MemberDialog member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
