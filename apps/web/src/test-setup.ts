import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest tanpa globals: RTL tidak membersihkan DOM otomatis antar test.
afterEach(() => cleanup());
