import { localHHMM, memberLabel, type BookingHoldInfo, type MemberDto, type UnitView } from '@funplay/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { useHasShift } from '../../hooks/useShift';
import { ApiError } from '../../lib/api';
import { useBoard } from '../../stores/board';
import { toast } from '../../stores/toast';
import { MemberPickerDialog } from '../members/MemberPicker';
import { useSessionAction } from './actions';
import { ModePicker, type StartMode } from './ModePicker';

const isHold = (err: unknown): err is ApiError => err instanceof ApiError && err.code === 'BOOKING_HOLD';

export function StartSession({ unit }: { unit: UnitView }) {
  const [mode, setMode] = useState<StartMode>('OPEN');
  const [packageId, setPackageId] = useState<string | null>(null);
  const [member, setMember] = useState<MemberDto | null>(null);
  const [picking, setPicking] = useState(false);
  const [hold, setHold] = useState<{ info: BookingHoldInfo | null; message: string } | null>(null);
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const action = useSessionAction({ quiet: isHold });
  const hasShift = useHasShift();

  const start = async (ignoreBooking = false) => {
    try {
      await action.mutateAsync({
        path: '/sessions',
        body: {
          unitId: unit.id,
          mode,
          ...(mode === 'PACKAGE' && packageId ? { packageId } : {}),
          ...(member ? { memberId: member.id } : {}),
          ...(ignoreBooking ? { ignoreBooking: true } : {}),
        },
      });
      setHold(null);
      toast.success(`${unit.name} dimulai`);
    } catch (err) {
      // BOOKING_HOLD → minta konfirmasi; error lain sudah ditampilkan oleh hook (showError)
      if (isHold(err)) setHold({ info: (err.details?.booking as BookingHoldInfo | undefined) ?? null, message: err.message });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <ModePicker unitTypeId={unit.unitTypeId} mode={mode} onMode={setMode} packageId={packageId} onPackage={setPackageId} />
      {member ? (
        <div className="flex items-center justify-between rounded-xl bg-bg p-2 text-sm">
          <span className="font-semibold">{`Member: ${memberLabel(member)}`}</span>
          <Button size="sm" variant="ghost" onClick={() => setMember(null)}>Lepas</Button>
        </div>
      ) : (
        <Button variant="soft" onClick={() => setPicking(true)}>Pilih member</Button>
      )}
      {!hasShift && <p className="text-sm text-amber-700">Buka shift dulu untuk memulai.</p>}
      <Button size="lg" onClick={() => void start()} disabled={!hasShift || action.isPending || (mode === 'PACKAGE' && !packageId)}>
        Mulai
      </Button>
      {picking && <MemberPickerDialog onPick={setMember} onClose={() => setPicking(false)} />}
      {hold && (
        <Modal
          open
          onOpenChange={(o) => !o && setHold(null)}
          title="Meja dibooking"
          footer={
            <>
              <Button variant="ghost" onClick={() => setHold(null)}>Batal</Button>
              <Button variant="warning" disabled={action.isPending} onClick={() => void start(true)}>Tetap mulai</Button>
            </>
          }
        >
          <p className="text-sm">
            {hold.info
              ? `Meja ini dibooking ${hold.info.customerName} jam ${localHHMM(new Date(hold.info.startAt), offset)}. Tetap mulai?`
              : `${hold.message}. Tetap mulai?`}
          </p>
        </Modal>
      )}
    </div>
  );
}
