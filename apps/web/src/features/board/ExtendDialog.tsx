import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { newId } from '../../lib/id';
import { useSessionAction } from './actions';

export function ExtendDialog({ sessionId, open, onClose }: { sessionId: string; open: boolean; onClose: () => void }) {
  const [minutes, setMinutes] = useState(30);
  const requestId = useMemo(() => newId(), [open]); // satu requestId per pembukaan dialog → klik ganda tidak dobel
  const action = useSessionAction();
  const submit = () => action.mutate({ path: `/sessions/${sessionId}/extend`, body: { minutes, requestId } }, { onSuccess: onClose });

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Tambah waktu"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={action.isPending || minutes < 1}>Tambah {minutes} menit</Button>
        </>
      }
    >
      <div className="mb-3 grid grid-cols-4 gap-2">
        {[15, 30, 60, 120].map((m) => (
          <Button key={m} variant={minutes === m ? 'primary' : 'soft'} onClick={() => setMinutes(m)}>
            {m >= 60 ? `${m / 60} jam` : `${m} mnt`}
          </Button>
        ))}
      </div>
      <label className="text-sm font-semibold">
        Menit lain
        <Input type="number" min={1} max={600} className="mt-1" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
      </label>
    </Modal>
  );
}
