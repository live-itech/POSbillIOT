import { expect, it, vi } from 'vitest';

it('melanjutkan AudioContext yang suspended sebelum berbunyi', async () => {
  const resume = vi.fn(async () => {});
  const node = () => ({ connect: (n: unknown) => n, start: vi.fn(), stop: vi.fn(), frequency: { value: 0 }, gain: { value: 0 } });
  class FakeAudioContext {
    state = 'suspended';
    currentTime = 0;
    destination = {};
    resume = resume;
    createOscillator = node;
    createGain = node;
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
  const { beep } = await import('./beep');
  beep('danger');
  expect(resume).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});
