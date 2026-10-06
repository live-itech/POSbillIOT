import type { CheckInResult } from '@funplay/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { api } from '../../lib/api';
import { useBoard } from '../../stores/board';
import { showError, toast } from '../../stores/toast';
import { ModePicker, type StartMode } from '../board/ModePicker';

export function CheckInDialog({ booking, onClose }: { booking: { id: string; customerName: string; unitId: string }; onClose: () => void }) {
  const unitTypeId = useBoard((s) => s.units[booking.unitId]?.unitTypeId ?? '');
  const [mode, setMode] = useState<StartMode>('OPEN');
  const [packageId, setPackageId] = useState<string | null>(null);
  const qc = useQueryClient();
  const go = useMutation({
    mutationFn: () => api<CheckInResult>('POST', `/bookings/${booking.id}/check-in`, { mode, ...(mode === 'PACKAGE' && packageId ? { packageId } : {}) }),
    onSuccess: (r) => {
      if (r.unit) {
        useBoard.getState().applyActionUnit(r.unit);
        useBoard.getState().select(r.unit.id);
      }
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      toast.success(`Check-in ${booking.customerName}`);
      onClose();
    },
    onError: showError,
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Check-in · ${booking.customerName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button disabled={go.isPending || (mode === 'PACKAGE' && !packageId)} onClick={() => go.mutate()}>Mulai</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ModePicker unitTypeId={unitTypeId} mode={mode} onMode={setMode} packageId={packageId} onPackage={setPackageId} />
      </div>
    </Modal>
  );
}
