import { DEFAULT_BOOKING_SETTINGS, DEFAULT_TRANSACTION_SETTINGS } from '@funplay/shared';
import type { UnitView } from '@funplay/shared';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { useBoard } from '../../stores/board';
import { UnitCard } from './UnitCard';

const base: UnitView = {
  id: 'u1', name: 'Meja 1', sortOrder: 1, unitTypeId: 'reg', unitTypeName: 'Reguler', unitTypeColor: '#7C3AED', area: '',
  deviceId: 'd1', relayChannel: 1, state: 'ACTIVE', lightOverride: null, light: true, deviceOnline: true,
  session: {
    id: 's1', billId: 'b1', mode: 'PACKAGE', status: 'RUNNING', startedAt: '2026-10-01T03:00:00.000Z',
    plannedEndAt: '2026-10-01T04:00:00.000Z', endedAt: null, packageName: 'Paket 1 Jam', packageDurationMin: 60, packagePrice: 45000,
    segments: [{ unitId: 'u1', unitTypeId: 'reg', startedAt: '2026-10-01T03:00:00.000Z', endedAt: null }], pauses: [],
  },
};

beforeEach(() => {
  useBoard.setState({
    settings: { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS, ...DEFAULT_BOOKING_SETTINGS },
    tariffs: [{ id: 't', unitTypeId: 'reg', name: 'Siang', daysMask: 127, startMin: 480, endMin: 1080, pricePerHour: 40000, priority: 0 }],
  });
});

it('paket hampir habis: status WARNING, hitung mundur, total paket', () => {
  render(<UnitCard unit={base} now={new Date('2026-10-01T03:56:00.000Z')} selected={false} onSelect={() => {}} />);
  const card = screen.getByTestId('unit-card-Meja 1');
  expect(card).toHaveAttribute('data-status', 'WARNING');
  expect(card).toHaveAttribute('data-light', 'on');
  expect(card).toHaveTextContent('00:04:00');
  expect(card).toHaveTextContent('Rp 45.000');
  expect(card).toHaveTextContent('Hampir habis');
});

it('meja kosong dan device offline', () => {
  render(<UnitCard unit={{ ...base, session: null, light: null, deviceOnline: false }} now={new Date('2026-10-01T03:00:00.000Z')} selected={false} onSelect={() => {}} />);
  expect(screen.getByTestId('unit-card-Meja 1')).toHaveAttribute('data-status', 'IDLE');
  expect(screen.getByLabelText('Device offline')).toBeInTheDocument();
});
