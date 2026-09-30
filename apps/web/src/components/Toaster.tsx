import { X } from 'lucide-react';
import { cn } from '../lib/cn';
import { useToasts } from '../stores/toast';

const styles = {
  info: 'bg-surface text-ink border-line',
  success: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  warning: 'bg-amber-50 text-amber-900 border-amber-300',
  danger: 'bg-rose-50 text-rose-900 border-rose-300',
};

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} role="status" className={cn('pointer-events-auto flex items-start gap-2 rounded-xl border p-3 text-sm font-medium shadow-lg', styles[t.level])}>
          <span className="flex-1">{t.message}</span>
          <button type="button" aria-label="Tutup" onClick={() => dismiss(t.id)}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
