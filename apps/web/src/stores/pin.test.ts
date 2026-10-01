import { expect, it } from 'vitest';
import { askPin, usePin } from './pin';

it('ask kedua menyelesaikan promise pertama dengan null', async () => {
  const first = askPin('A');
  const second = askPin('B');
  await expect(first).resolves.toBeNull();
  usePin.getState().close('1234');
  await expect(second).resolves.toBe('1234');
  expect(usePin.getState().open).toBe(false);
});
