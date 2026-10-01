const KEY = 'fp-theme';

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function initTheme(): void {
  document.documentElement.classList.toggle('dark', read() === 'dark');
}

export function toggleTheme(): void {
  const dark = !document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem(KEY, dark ? 'dark' : 'light');
  } catch {
    // abaikan: mode privat
  }
}
