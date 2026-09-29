import { expect, it } from 'vitest';
import { outletLabels } from './labels';

it('label mengikuti jenis outlet', () => {
  expect(outletLabels('BILLIARD')).toEqual({ unit: 'Meja', icon: '🎱' });
  expect(outletLabels('PLAYSTATION')).toEqual({ unit: 'Unit', icon: '🎮' });
});
