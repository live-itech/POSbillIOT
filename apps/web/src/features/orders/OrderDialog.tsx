import type { CategoryDto, ProductDto } from '@funplay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { useHasShift } from '../../hooks/useShift';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatRupiah, parseRupiah } from '../../lib/format';
import { showError, toast } from '../../stores/toast';

type CartItem = { key: string; name: string; price: number; qty: number } & ({ productId: string } | { custom: { name: string; price: number } });

export function OrderDialog({ billId, title, open, onClose }: { billId: string; title: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const hasShift = useHasShift();
  const categories = useQuery({ queryKey: ['/categories'], queryFn: () => api<CategoryDto[]>('GET', '/categories'), enabled: open });
  const products = useQuery({ queryKey: ['/products'], queryFn: () => api<ProductDto[]>('GET', '/products'), enabled: open });
  const [cat, setCat] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [manual, setManual] = useState<null | { name: string; price: string }>(null);
  useEffect(() => {
    if (open) {
      setCart([]);
      setSearch('');
      setManual(null);
    }
  }, [open]);

  const add = useMutation({
    mutationFn: () =>
      api('POST', `/bills/${billId}/items`, {
        items: cart.map((c) => ('productId' in c ? { productId: c.productId, qty: c.qty } : { custom: c.custom, qty: c.qty })),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bill', billId] });
      void qc.invalidateQueries({ queryKey: ['bills'] });
      toast.success('Pesanan ditambahkan');
      onClose();
    },
    onError: showError,
  });

  const color = new Map((categories.data ?? []).map((c) => [c.id, c.color]));
  const list = (products.data ?? []).filter(
    (p) => p.active && (cat === 'ALL' || p.categoryId === cat) && p.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const bump = (key: string, d: number) =>
    setCart((cs) => cs.map((c) => (c.key === key ? { ...c, qty: c.qty + d } : c)).filter((c) => c.qty > 0));
  const pick = (p: ProductDto) =>
    setCart((cs) => (cs.some((c) => c.key === p.id) ? cs.map((c) => (c.key === p.id ? { ...c, qty: c.qty + 1 } : c)) : [...cs, { key: p.id, productId: p.id, name: p.name, price: p.price, qty: 1 }]));
  const addManual = () => {
    if (!manual || !manual.name.trim()) return;
    const price = parseRupiah(manual.price);
    setCart((cs) => [...cs, { key: `m-${cs.length}-${manual.name}`, custom: { name: manual.name.trim(), price }, name: manual.name.trim(), price, qty: 1 }]);
    setManual(null);
  };
  const total = cart.reduce((a, c) => a + c.price * c.qty, 0);

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={title} width="max-w-4xl">
      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {[{ id: 'ALL', name: 'Semua' }, ...(categories.data ?? []).filter((c) => c.active)].map((c) => (
              <button key={c.id} type="button" onClick={() => setCat(c.id)}
                className={cn('rounded-full px-3 py-1 text-sm font-semibold', cat === c.id ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink')}>
                {c.name}
              </button>
            ))}
          </div>
          <label className="text-sm font-semibold">
            Cari produk
            <Input className="mt-1" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {list.map((p) => (
              <button key={p.id} type="button" onClick={() => pick(p)}
                className="flex flex-col items-start gap-1 rounded-xl border-l-4 bg-bg p-3 text-left text-sm font-semibold transition hover:brightness-95"
                style={{ borderLeftColor: color.get(p.categoryId) ?? '#7C3AED' }}>
                <span>{p.name}</span>
                <span className="text-primary-ink">{formatRupiah(p.price)}</span>
                {p.kind === 'STOCK' && p.stockQty <= 0 && <span className="text-xs text-rose-600">Stok habis</span>}
              </button>
            ))}
          </div>
          {manual ? (
            <div className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
              <label className="text-sm font-semibold">Nama item<Input className="mt-1" autoFocus value={manual.name} maxLength={60} onChange={(e) => setManual({ ...manual, name: e.target.value })} /></label>
              <label className="text-sm font-semibold">Harga<Input className="mt-1" inputMode="numeric" value={manual.price} onChange={(e) => setManual({ ...manual, price: e.target.value.replace(/\D/g, '') })} /></label>
              <Button onClick={addManual}>Masukkan</Button>
            </div>
          ) : (
            <Button variant="soft" className="self-start" onClick={() => setManual({ name: '', price: '' })}>Item manual</Button>
          )}
        </div>
        <aside className="flex flex-col gap-2 rounded-xl bg-bg p-3">
          <h3 className="font-bold">Keranjang</h3>
          {cart.length === 0 && <p className="text-sm text-muted">Pilih produk di sebelah kiri.</p>}
          {cart.map((c, i) => (
            <div key={c.key} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <button type="button" aria-label={`Kurangi jumlah keranjang ${i + 1}`} onClick={() => bump(c.key, -1)}><Minus size={14} /></button>
              <span className="w-6 text-center tabular-nums">{c.qty}</span>
              <button type="button" aria-label={`Tambah jumlah keranjang ${i + 1}`} onClick={() => bump(c.key, 1)}><Plus size={14} /></button>
            </div>
          ))}
          <div className="mt-auto flex justify-between border-t border-line pt-2 font-bold">
            <span>Total</span>
            <span className="tabular-nums">{formatRupiah(total)}</span>
          </div>
          {!hasShift && <p className="text-xs text-rose-600">Buka shift dulu untuk menambah pesanan.</p>}
          <Button disabled={cart.length === 0 || add.isPending || !hasShift} onClick={() => add.mutate()}>Tambahkan</Button>
        </aside>
      </div>
    </Modal>
  );
}
