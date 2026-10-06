import type { PublicSettings } from '@funplay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { showError, toast } from '../../stores/toast';

/** Salinan pengaturan yang bisa diedit + simpan sebagian (PUT /settings). */
export function useSettingsDraft() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['/settings'], queryFn: () => api<PublicSettings>('GET', '/settings') });
  const [v, setV] = useState<PublicSettings | null>(null);
  useEffect(() => {
    if (q.data) setV(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (body: Partial<PublicSettings>) => api<PublicSettings>('PUT', '/settings', body),
    onSuccess: (data) => {
      qc.setQueryData(['/settings'], data);
      toast.success('Pengaturan disimpan');
    },
    onError: showError,
  });
  return { v, setV, save };
}
