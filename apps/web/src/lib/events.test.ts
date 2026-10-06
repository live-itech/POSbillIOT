import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { handleRealtime } from './events';
import { useToasts } from '../stores/toast';

describe('handleRealtime', () => {
  it('bill → invalidate bill & daftar bill; shift → shift; printJob gagal → toast', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    handleRealtime(qc, { type: 'bill', id: 'b1' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['bill', 'b1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['bills'] });
    handleRealtime(qc, { type: 'shift' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['shift'] });
    handleRealtime(qc, { type: 'printJob', job: { id: 'j', kind: 'RECEIPT', status: 'FAILED', error: 'Printer LAN gagal', previewText: '', billId: 'b1', shiftId: null, createdAt: '' } });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['printJobs'] });
    expect(useToasts.getState().toasts.at(-1)).toMatchObject({ level: 'danger', message: 'Cetak gagal: Printer LAN gagal' });
  });

  it('booking → invalidate daftar booking; resync ikut memuat ulang booking', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    handleRealtime(qc, { type: 'booking', id: 'bk1' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['bookings'] });
    spy.mockClear();
    handleRealtime(qc, { type: 'resync' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['bookings'] });
  });
});
