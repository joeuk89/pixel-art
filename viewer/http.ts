export class NotFound extends Error {}

export async function fetchOk(url: URL): Promise<Response> {
  const response = await fetch(url);
  if (response.status === 404) throw new NotFound(url.href);
  if (!response.ok) throw new Error(`${url.href}: HTTP ${response.status}`);
  return response;
}

export async function fetchJson(url: URL): Promise<unknown> {
  return (await fetchOk(url)).json();
}
