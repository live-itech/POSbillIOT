import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => void;
const mock = vi.hoisted(() => {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const socket = { on: vi.fn((e: string, h: (...a: unknown[]) => void) => { handlers[e] = h; }), connect: vi.fn(), disconnect: vi.fn() };
  return { handlers, socket };
});
vi.mock('socket.io-client', () => ({ io: () => mock.socket }));

import { connectBoard } from './socket';

const fire = (e: string, ...a: unknown[]) => (mock.handlers[e] as Handler)(...a);

beforeEach(() => {
  vi.useFakeTimers();
  mock.socket.connect.mockClear();
  mock.socket.disconnect.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('connectBoard', () => {
  it('reconnect setelah io server disconnect ditunda 2 detik', () => {
    connectBoard(() => {}, () => {});
    fire('disconnect', 'io server disconnect');
    expect(mock.socket.connect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1999);
    expect(mock.socket.connect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(mock.socket.connect).toHaveBeenCalledTimes(1);
  });

  it('tidak reconnect bila cleanup sudah dijalankan', () => {
    const stop = connectBoard(() => {}, () => {});
    fire('disconnect', 'io server disconnect');
    stop();
    vi.advanceTimersByTime(5000);
    expect(mock.socket.connect).not.toHaveBeenCalled();
  });

  it('disconnect lain tidak memicu reconnect manual', () => {
    connectBoard(() => {}, () => {});
    fire('disconnect', 'transport close');
    vi.advanceTimersByTime(5000);
    expect(mock.socket.connect).not.toHaveBeenCalled();
  });

  it('connect_error UNAUTHORIZED memanggil onUnauthorized', () => {
    const onUnauthorized = vi.fn();
    connectBoard(() => {}, onUnauthorized);
    fire('connect_error', new Error('UNAUTHORIZED'));
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('connect_error lain tidak memanggil onUnauthorized', () => {
    const onUnauthorized = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    connectBoard(() => {}, onUnauthorized);
    fire('connect_error', new Error('xhr poll error'));
    expect(onUnauthorized).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
