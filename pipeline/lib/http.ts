export class HttpError extends Error {
  status: number;
  constructor(what: string, status: number) {
    super(`${what}: HTTP ${status}`);
    this.status = status;
  }
}

async function request(what: string, url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) throw new HttpError(what, res.status);
  return res;
}

export async function getJson<T>(what: string, url: string, init?: RequestInit): Promise<T> {
  return (await (await request(what, url, init)).json()) as T;
}

export async function getBytes(what: string, url: string, init?: RequestInit): Promise<Uint8Array> {
  return new Uint8Array(await (await request(what, url, init)).arrayBuffer());
}
