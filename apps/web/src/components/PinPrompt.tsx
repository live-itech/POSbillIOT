import { useEffect, useState, type FormEvent } from 'react';
import { usePin } from '../stores/pin';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Modal } from './ui/modal';

export function PinPrompt() {
  const { open, title, close } = usePin();
  const [pin, setPin] = useState('');
  useEffect(() => {
    if (open) setPin('');
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pin.length >= 4) close(pin);
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && close(null)} title={title} width="max-w-xs">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          aria-label="PIN supervisor"
          type="password"
          inputMode="numeric"
          autoFocus
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          className="text-center text-2xl tracking-[0.5em]"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(null)}>Batal</Button>
          <Button type="submit" disabled={pin.length < 4}>Konfirmasi</Button>
        </div>
      </form>
    </Modal>
  );
}
