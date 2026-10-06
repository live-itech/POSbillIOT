import { Route, Routes } from 'react-router';
import { PinPrompt } from './components/PinPrompt';
import { Toaster } from './components/Toaster';
import { RequireAuth, RequireRole } from './features/auth/auth';
import { BoardPage } from './features/board/BoardPage';
import { LoginPage } from './features/auth/LoginPage';
import { AppShell } from './features/layout/AppShell';
import { ShiftPage } from './features/shift/ShiftPage';
import { SettingsPage } from './features/settings/SettingsPage';

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
          <Route index element={<BoardPage />} />
          <Route path="shift" element={<ShiftPage />} />
          <Route
            path="settings"
            element={
              <RequireRole roles={['OWNER']}>
                <SettingsPage />
              </RequireRole>
            }
          />
        </Route>
      </Routes>
      <Toaster />
      <PinPrompt />
    </>
  );
}
