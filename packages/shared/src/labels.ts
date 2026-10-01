import type { OutletType } from './constants';

export function outletLabels(t: OutletType): { unit: string; icon: string } {
  return t === 'PLAYSTATION' ? { unit: 'Unit', icon: '🎮' } : { unit: 'Meja', icon: '🎱' };
}
