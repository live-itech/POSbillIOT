import { DEFAULT_TRANSACTION_SETTINGS, type BillView, type PublicSettings } from '@funplay/shared';
import { expect, it } from 'vitest';
import { computeBillPreview } from './useBill';

const settings: PublicSettings = { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS };

it('pratinjau menjumlahkan baris tersimpan + biaya waktu sesi yang masih berjalan', () => {
  const bill: BillView = {
    id: 'b1', number: 'FP-1', label: 'Meja 1', status: 'OPEN', createdAt: '', createdByName: 'k', billDiscount: null,
    lines: [{ id: 'l1', type: 'PRODUCT', productId: 'p', sessionId: null, name: 'Es Teh', unitPrice: 8000, qty: 2, discount: null, breakdown: null }],
    activeSessions: [{
      id: 's1', billId: 'b1', unitName: 'Meja 1', mode: 'OPEN', status: 'RUNNING', startedAt: '2026-10-01T03:00:00.000Z', plannedEndAt: null, endedAt: null,
      packageName: null, packageDurationMin: null, packagePrice: null,
      segments: [{ unitId: 'u1', unitTypeId: 'reg', startedAt: '2026-10-01T03:00:00.000Z', endedAt: null }], pauses: [],
    }],
    payments: [], stored: null, paidAt: null, paidByName: null, shiftId: null, mergedIntoId: null, cancelReason: null, voidReason: null, voidedAt: null,
  };
  const tariffs = [{ id: 't', name: 'Reguler Siang', unitTypeId: 'reg', daysMask: 127, startMin: 480, endMin: 1080, pricePerHour: 40000, priority: 0 }];
  const p = computeBillPreview(bill, settings, tariffs, new Date('2026-10-01T03:30:00Z'));
  expect(p.liveTime[0]!.charge!.total).toBe(40000); // minimum 60 menit
  expect(p.totals.grandTotal).toBe(56000);
});
