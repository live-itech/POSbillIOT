import type { PublicUser, Role } from '@funplay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api } from '../../lib/api';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<{ user: PublicUser }>('GET', '/auth/me').then((r) => r.user) });
}

export function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api<void>('POST', '/auth/logout', {}),
    onSettled: () => {
      qc.clear();
      navigate('/login', { replace: true });
    },
  });
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading) return <div className="grid h-full place-items-center text-muted">Memuat…</div>;
  if (me.isError || !me.data) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const me = useMe();
  if (!me.data || !roles.includes(me.data.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
