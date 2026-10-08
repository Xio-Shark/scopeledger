// Idempotency for the two outward-facing actions: creating and sending an invoice.
//
// Sending twice must not create a second invoice. The store is process-local (single container);
// the key is derived from the scope id so a retry after a crash is still a no-op within the run.
export type IdempotencyOutcome<T> = { value: T; replayed: boolean };

export class IdempotencyStore<T> {
  private readonly done = new Map<string, T>();
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(private readonly keyOf: (scopeId: string) => string) {}

  async once(scopeId: string, run: () => Promise<T>): Promise<IdempotencyOutcome<T>> {
    const key = this.keyOf(scopeId);
    if (this.done.has(key)) return { value: this.done.get(key) as T, replayed: true };
    const existing = this.inflight.get(key);
    if (existing) return { value: await existing, replayed: true };

    const promise = run().then(
      (value) => {
        this.done.set(key, value);
        this.inflight.delete(key);
        return value;
      },
      (err) => {
        this.inflight.delete(key); // a failure is retryable; only success is remembered
        throw err;
      },
    );
    this.inflight.set(key, promise);
    return { value: await promise, replayed: false };
  }

  has(scopeId: string): boolean {
    return this.done.has(this.keyOf(scopeId));
  }
}

export const invoiceSendStore = new IdempotencyStore<{ invoiceId: string; sent: true }>(
  (scopeId) => `invoice:send:${scopeId}`,
);
