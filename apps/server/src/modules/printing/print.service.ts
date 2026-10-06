import { Prisma, type PrintJob, type PrintKind } from '@prisma/client';
import { encodeEscPos, formatReceiptDate, renderReceipt, renderShiftReport, renderTestPage, toPlainText, type PrintJobView, type PrintLine } from '@funplay/shared';
import type { AppContext } from '../../context';
import { getSettings } from '../settings/settings.service';
import type { PrinterFactory } from './printer';
import { buildReceiptModel, buildShiftReportModel } from './receipt-model';

const toView = (j: PrintJob): PrintJobView => ({
  id: j.id, kind: j.kind, status: j.status, error: j.error, previewText: j.previewText, billId: j.billId, shiftId: j.shiftId, createdAt: j.createdAt.toISOString(),
});

export class PrintService {
  private readonly pending = new Set<Promise<unknown>>();

  constructor(private readonly ctx: AppContext, private readonly factory: PrinterFactory) {}

  /** Jalankan tugas cetak setelah commit: tidak ditunggu pemanggil dan tidak pernah melempar. */
  later(task: () => Promise<unknown>): void {
    this.track(task().catch((err: unknown) => console.error('tugas cetak gagal', err)));
  }

  /** Tunggu semua tugas cetak selesai (dipakai saat app ditutup agar tidak ada kerja menggantung). */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private track(p: Promise<unknown>): void {
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  async printReceipt(userId: string, billId: string, reprint = false): Promise<PrintJobView> {
    const settings = await getSettings(this.ctx.prisma);
    const lines = renderReceipt(await buildReceiptModel(this.ctx.prisma, billId, settings, this.ctx.clock.now(), reprint));
    return this.enqueue('RECEIPT', { billId }, lines, userId);
  }

  async printShiftReport(userId: string, shiftId: string): Promise<PrintJobView> {
    const settings = await getSettings(this.ctx.prisma);
    const lines = renderShiftReport(await buildShiftReportModel(this.ctx.prisma, shiftId, settings, this.ctx.clock.now()));
    return this.enqueue('SHIFT_REPORT', { shiftId }, lines, userId);
  }

  async printTest(userId: string): Promise<PrintJobView> {
    const settings = await getSettings(this.ctx.prisma);
    return this.enqueue('TEST', {}, renderTestPage(settings.outletName, formatReceiptDate(this.ctx.clock.now(), settings.utcOffsetMin)), userId);
  }

  async listJobs(limit: number): Promise<PrintJobView[]> {
    return (await this.ctx.prisma.printJob.findMany({ orderBy: { createdAt: 'desc' }, take: limit })).map(toView);
  }

  private async enqueue(kind: PrintKind, refs: { billId?: string; shiftId?: string }, lines: PrintLine[], userId: string): Promise<PrintJobView> {
    const job = await this.ctx.prisma.printJob.create({
      data: { kind, billId: refs.billId ?? null, shiftId: refs.shiftId ?? null, previewText: toPlainText(lines), requestedById: userId },
    });
    const view = toView(job);
    this.ctx.bus.emit('print.job', view);
    this.track(this.deliver(job.id, lines));
    return view;
  }

  /** Tidak pernah melempar: kegagalan dicatat di job. */
  private async deliver(jobId: string, lines: PrintLine[]): Promise<void> {
    const { prisma } = this.ctx;
    let status: 'DONE' | 'FAILED' = 'DONE';
    let error: string | null = null;
    try {
      const settings = await getSettings(prisma);
      await this.factory(settings).send(encodeEscPos(lines));
    } catch (e) {
      status = 'FAILED';
      error = e instanceof Error ? e.message : String(e);
    }
    try {
      const job = await prisma.printJob.update({ where: { id: jobId }, data: { status, error } });
      this.ctx.bus.emit('print.job', toView(job));
    } catch (e) {
      // P2025: job hilang (DB direset di test); selebihnya dicatat.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025')) console.error('gagal memperbarui job cetak', e);
    }
  }
}
