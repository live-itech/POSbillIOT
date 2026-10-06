import type { Db } from '../../db';
import { notFound } from '../../lib/errors';

/** SELECT … FOR UPDATE baris Booking. Urutan kunci global: Session → Bill → Booking → Shift → Product. */
export async function lockBooking(tx: Db, bookingId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
  if (!rows.length) throw notFound('Booking');
}
