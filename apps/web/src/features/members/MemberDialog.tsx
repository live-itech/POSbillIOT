import type { MemberDto, MemberLevelDto } from '@funplay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { api } from '../../lib/api';
import { showError, toast } from '../../stores/toast';

export function MemberDialog({ member, onClose }: { member: MemberDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const levels = useQuery({ queryKey: ['/member-levels'], queryFn: () => api<MemberLevelDto[]>('GET', '/member-levels') });
  const [name, setName] = useState(member?.name ?? '');
  const [phone, setPhone] = useState(member?.phone ?? '');
  const [levelId, setLevelId] = useState(member?.levelId ?? '');
  const save = useMutation({
    mutationFn: (body: { name: string; phone: string; levelId: string }) =>
      member ? api<MemberDto>('PATCH', `/members/${member.id}`, body) : api<MemberDto>('POST', '/members', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['members'] });
      toast.success('Member disimpan');
      onClose();
    },
    onError: showError,
  });
  const options = (levels.data ?? []).filter((l) => l.active || l.id === levelId);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ name: name.trim(), phone: phone.trim(), levelId });
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={member ? 'Ubah member' : 'Tambah member'}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="text-sm font-semibold">
          Nama
          <Input className="mt-1" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="text-sm font-semibold">
          No. HP
          <Input className="mt-1" inputMode="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <div className="flex flex-col gap-1 text-sm font-semibold">
          <label htmlFor="member-level">Level</label>
          <select id="member-level" required className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm" value={levelId} onChange={(e) => setLevelId(e.target.value)}>
            <option value="">— pilih —</option>
            {options.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button type="submit" disabled={save.isPending}>Simpan</Button>
        </div>
      </form>
    </Modal>
  );
}
