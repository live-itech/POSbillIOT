import type { PublicUser } from '@funplay/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Logo } from '../../components/brand/Brand';
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
      <div className="flex w-full max-w-sm overflow-hidden rounded-3xl bg-surface shadow-2xl lg:max-w-4xl">
        <div className="hidden flex-1 items-center bg-violet-50 lg:flex">
          <img src="/brand/login-illustration.webp" alt="" aria-hidden className="h-auto w-full" />
        </div>
        <form onSubmit={submit} className="w-full p-8 lg:max-w-sm">
          <h1 className="mb-2 flex justify-center">
            <Logo className="h-14" />
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
    </div>
  );
}
