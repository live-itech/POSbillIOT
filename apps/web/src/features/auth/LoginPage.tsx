import type { PublicUser } from '@funplay/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { api } from '../../lib/api';
import { showError } from '../../stores/toast';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const login = useMutation({
    mutationFn: () => api<{ user: PublicUser }>('POST', '/auth/login', { username, password }),
    onSuccess: (r) => {
      qc.setQueryData(['me'], r.user);
      navigate('/', { replace: true });
    },
    onError: showError,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  return (
    <div className="grid min-h-full place-items-center bg-gradient-to-br from-violet-600 via-violet-500 to-fuchsia-500 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl bg-surface p-8 shadow-2xl">
        <h1 className="mb-1 text-center text-3xl font-extrabold tracking-tight text-primary">
          Fun<span className="text-accent">Play</span>
        </h1>
        <p className="mb-6 text-center text-sm text-muted">Masuk untuk mulai shift</p>
        <label className="mb-3 block text-sm font-semibold">
          Username
          <Input className="mt-1" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="mb-6 block text-sm font-semibold">
          Password
          <Input className="mt-1" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <Button type="submit" size="lg" className="w-full" disabled={login.isPending || !username || !password}>
          Masuk
        </Button>
      </form>
    </div>
  );
}
