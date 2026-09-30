import { Route, Routes } from 'react-router';
import { PinPrompt } from './components/PinPrompt';
import { Toaster } from './components/Toaster';
import { RequireAuth } from './features/auth/auth';
import { BoardPage } from './features/board/BoardPage';
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
          <Route index element={<BoardPage />} />
        </Route>
      </Routes>
      <Toaster />
      <PinPrompt />
    </>
  );
}
