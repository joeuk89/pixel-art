import { randomUUID } from "node:crypto";

export const MAX_RETRIES = 3;

export type Retry = { idempotencyKey: string; error: string };

const transient = (e: unknown) => {
  const status = (e as { status?: unknown }).status;
  return (typeof status === "number" && status >= 500) || /inference_failed/.test((e as Error).message);
};

// A fresh key on every try, so the service never answers a retry with the cached failure.
export async function withFreshKey<T>(run: (idempotencyKey: string) => Promise<T>): Promise<{ value: T; retries: Retry[] }> {
  const retries: Retry[] = [];
  for (;;) {
    const idempotencyKey = randomUUID();
    try {
      return { value: await run(idempotencyKey), retries };
    } catch (e) {
      if (!transient(e) || retries.length >= MAX_RETRIES) throw e;
      retries.push({ idempotencyKey, error: (e as Error).message });
    }
  }
}
