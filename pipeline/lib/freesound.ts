import { getBytes, getJson } from "./http.ts";
import { service } from "./services.ts";

export type FreesoundSound = {
  id: number;
  name: string;
  username: string;
  duration: number;
  license: string;
  type: string;
  url: string;
  previews: Record<string, string>;
};

const FIELDS = "id,name,username,duration,license,tags,description,type,samplerate,channels,url,previews";

export function isCc0(sound: FreesoundSound): boolean {
  return sound.license.includes("publicdomain/zero");
}

export async function getSound(id: number): Promise<FreesoundSound> {
  const { baseUrl, key } = service("freesound");
  const url = `${baseUrl}/sounds/${id}/?fields=${FIELDS}&token=${encodeURIComponent(key)}`;
  return getJson<FreesoundSound>(`freesound ${id}`, url);
}

export async function downloadPreview(sound: FreesoundSound): Promise<Uint8Array> {
  return getBytes(`freesound ${sound.id} preview`, sound.previews["preview-hq-ogg"]);
}

export async function searchCount(query: string): Promise<number> {
  const { baseUrl, key } = service("freesound");
  const url = `${baseUrl}/search/text/?query=${encodeURIComponent(query)}&page_size=1&token=${encodeURIComponent(key)}`;
  return (await getJson<{ count: number }>("freesound search", url)).count;
}
