let counter = 0;

/** ID unik tanpa crypto.randomUUID (tidak tersedia di http LAN). */
export function newId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
