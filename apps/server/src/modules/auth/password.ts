import argon2 from 'argon2';

export function hashSecret(plain: string): Promise<string> {
  return argon2.hash(plain);
}

export function verifySecret(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain).catch(() => false);
}
