import { Route, Routes } from 'react-router';
import { Toaster } from './components/Toaster';
import { RequireAuth } from './features/auth/auth';
import { LoginPage } from './features/auth/LoginPage';
import { AppShell } from './features/layout/AppShell';

export function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<div className="text-muted">Dashboard meja (Task 17)</div>} />
        </Route>
      </Routes>
      <Toaster />
    </>
  );
}
