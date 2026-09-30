import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatRupiah } from '../../lib/format';
import { showError, toast } from '../../stores/toast';

export type FieldType = 'text' | 'number' | 'money' | 'select' | 'checkbox' | 'time' | 'days' | 'password';

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  nullable?: boolean;
  omitIfEmpty?: boolean;
  hideInTable?: boolean;
  options?: { value: string; label: string }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  optionsFrom?: { path: string; label: (row: any) => string };
  defaultValue?: unknown;
}

export interface ResourceConfig {
  title: string;
  path: string;
  fields: Field[];
  canDelete?: boolean;
}

type Row = { id: string } & Record<string, unknown>;
type Values = Record<string, unknown>;

const DAY_LABELS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

export function toPayload(fields: Field[], values: Values): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.name];
    const empty = v === '' || v === undefined || v === null;
    if (f.omitIfEmpty && empty) continue;
    switch (f.type) {
      case 'number':
      case 'money':
        out[f.name] = empty ? (f.nullable ? null : 0) : Number(v);
        break;
      case 'checkbox':
        out[f.name] = Boolean(v);
        break;
      case 'select':
        out[f.name] = empty ? (f.nullable ? null : '') : v;
        break;
      case 'days':
        out[f.name] = Array.isArray(v) ? v : [];
        break;
      default:
        out[f.name] = empty ? '' : v;
    }
  }
  return out;
}

function initialValues(fields: Field[], row: Row | null): Values {
  const v: Values = {};
  for (const f of fields) {
    if (row && f.type !== 'password') v[f.name] = row[f.name] ?? (f.type === 'checkbox' ? false : '');
    else v[f.name] = f.defaultValue ?? (f.type === 'checkbox' ? true : f.type === 'days' ? [0, 1, 2, 3, 4, 5, 6] : '');
  }
  return v;
}

function useOptions(f: Field) {
  const q = useQuery({
    queryKey: [f.optionsFrom?.path ?? 'none'],
    queryFn: () => api<Row[]>('GET', f.optionsFrom!.path),
    enabled: !!f.optionsFrom,
  });
  if (f.options) return f.options;
  return (q.data ?? []).map((r) => ({ value: r.id, label: f.optionsFrom!.label(r) }));
}

function SelectField({ f, value, onChange }: { f: Field; value: unknown; onChange: (v: unknown) => void }) {
  const options = useOptions(f);
  return (
    <select
      id={`f-${f.name}`}
      className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm"
      required={f.required}
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{f.nullable ? '— tidak ada —' : '— pilih —'}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function FieldInput({ f, value, onChange, isNew }: { f: Field; value: unknown; onChange: (v: unknown) => void; isNew: boolean }) {
  switch (f.type) {
    case 'select':
      return <SelectField f={f} value={value} onChange={onChange} />;
    case 'checkbox':
      return <input id={`f-${f.name}`} type="checkbox" className="h-5 w-5 accent-violet-600" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    case 'days': {
      const days = (value as number[]) ?? [];
      return (
        <div className="flex flex-wrap gap-1" id={`f-${f.name}`}>
          {DAY_LABELS.map((d, i) => (
            <button
              key={d}
              type="button"
              onClick={() => onChange(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())}
              className={cn('rounded-lg px-2 py-1 text-xs font-bold', days.includes(i) ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink')}
            >
              {d}
            </button>
          ))}
        </div>
      );
    }
    default:
      return (
        <Input
          id={`f-${f.name}`}
          type={f.type === 'money' ? 'number' : f.type === 'time' ? 'time' : f.type}
          required={f.required && (f.type !== 'password' || isNew)}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function display(f: Field, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (f.type === 'money') return formatRupiah(Number(v));
  if (f.type === 'checkbox') return v ? 'Ya' : 'Tidak';
  if (f.type === 'days') return (v as number[]).map((d) => DAY_LABELS[d]).join(', ');
  return String(v);
}

function CellValue({ f, row }: { f: Field; row: Row }) {
  const options = useOptions(f);
  if (f.type === 'select') return <>{options.find((o) => o.value === row[f.name])?.label ?? display(f, row[f.name])}</>;
  return <>{display(f, row[f.name])}</>;
}

export function CrudResource({ config }: { config: ResourceConfig }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: [config.path], queryFn: () => api<Row[]>('GET', config.path) });
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [values, setValues] = useState<Values>({});

  const open = (row: Row | 'new') => {
    setEditing(row);
    setValues(initialValues(config.fields, row === 'new' ? null : row));
  };
  const refresh = () => void qc.invalidateQueries({ queryKey: [config.path] });
  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing === 'new' ? api('POST', config.path, payload) : api('PATCH', `${config.path}/${(editing as Row).id}`, payload),
    onSuccess: refresh,
    onError: showError,
  });
  const del = useMutation({ mutationFn: (id: string) => api('DELETE', `${config.path}/${id}`), onSuccess: refresh, onError: showError });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const fields = editing === 'new' ? config.fields : config.fields.map((f) => (f.type === 'password' ? { ...f, omitIfEmpty: true } : f));
    try {
      await save.mutateAsync(toPayload(fields, values));
    } catch {
      return; // sudah ditampilkan oleh onError
    }
    setEditing(null);
    toast.success('Tersimpan');
  };
  const remove = async (id: string) => {
    if (!window.confirm('Hapus data ini?')) return;
    try {
      await del.mutateAsync(id);
    } catch {
      return;
    }
    toast.success('Terhapus');
  };
  const cols = config.fields.filter((f) => !f.hideInTable && f.type !== 'password');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{config.title}</h2>
        <Button onClick={() => open('new')}>
          <Plus size={16} /> Tambah
        </Button>
      </div>
      <div className="overflow-x-auto rounded-2xl bg-surface shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-primary-soft text-left text-primary-ink">
            <tr>
              {cols.map((f) => <th key={f.name} className="px-3 py-2 font-bold">{f.label}</th>)}
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((row) => (
              <tr key={row.id} className="border-t border-line">
                {cols.map((f) => (
                  <td key={f.name} className="px-3 py-2"><CellValue f={f} row={row} /></td>
                ))}
                <td className="flex justify-end gap-1 px-3 py-2">
                  <Button size="sm" variant="ghost" aria-label="Ubah" onClick={() => open(row)}><Pencil size={14} /></Button>
                  {config.canDelete && (
                    <Button size="sm" variant="ghost" aria-label="Hapus" disabled={del.isPending} onClick={() => void remove(row.id)}>
                      <Trash2 size={14} />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? `Tambah ${config.title}` : `Ubah ${config.title}`}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {config.fields.map((f) => (
            <div key={f.name} className="flex flex-col gap-1 text-sm font-semibold">
              <label htmlFor={`f-${f.name}`}>{f.label}</label>
              <FieldInput isNew={editing === 'new'} f={f} value={values[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
            </div>
          ))}
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>Batal</Button>
            <Button type="submit" disabled={save.isPending}>Simpan</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
