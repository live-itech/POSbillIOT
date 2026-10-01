export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class FakeClock implements Clock {
  private t: number;
  constructor(t: Date) {
    this.t = t.getTime();
  }
  now(): Date {
    return new Date(this.t);
  }
  set(t: Date): void {
    this.t = t.getTime();
  }
  advanceMinutes(m: number): void {
    this.t += m * 60_000;
  }
}
