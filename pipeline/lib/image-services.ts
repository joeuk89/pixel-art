import sharp from "sharp";
import { fitsProFlash, PRO_FLASH_MAX_SIDE, type Canvas } from "./canvas.ts";
import { createImagePixflux, createImageProFlash, generateImageV2, STYLE_OPTIONS, STYLE_USAGE } from "./pixellab.ts";
import { RD_PLUS_ENVIRONMENT, rdPlusEnvironment } from "./retro-diffusion.ts";
import { withFreshKey } from "./retry.ts";

export const IMAGE_SERVICES = ["pro-flash", "pro", "pixflux", "rd-plus"] as const;
export type ImageService = (typeof IMAGE_SERVICES)[number];

type Info = { vendor: "pixellab" | "retro-diffusion"; model: string; takesStyle: boolean; minSide: number; maxSide: number };

const INFO: Record<ImageService, Info> = {
  "pro-flash": { vendor: "pixellab", model: "pro-flash", takesStyle: true, minSide: 16, maxSide: PRO_FLASH_MAX_SIDE },
  pro: { vendor: "pixellab", model: "generate-image-v2", takesStyle: true, minSide: 16, maxSide: 688 },
  pixflux: { vendor: "pixellab", model: "create-image-pixflux", takesStyle: false, minSide: 16, maxSide: 400 },
  "rd-plus": { vendor: "retro-diffusion", model: RD_PLUS_ENVIRONMENT, takesStyle: false, minSide: 64, maxSide: 384 },
};

const ALTERNATIVES =
  "pro (PixelLab Pro, about 25 generations, takes the Style anchor), pixflux (PixelLab Pixflux, 1 generation, no Style anchor) " +
  "or rd-plus (Retro Diffusion RD Plus, $0.06, no Style anchor)";

export const serviceInfo = (name: ImageService) => INFO[name];

export function parseService(value: string | undefined): ImageService {
  if (value === undefined) return "pro-flash";
  if (!(IMAGE_SERVICES as readonly string[]).includes(value)) throw new Error(`--service must be one of ${IMAGE_SERVICES.join(", ")}; got ${value}`);
  return value as ImageService;
}

export function checkService(name: ImageService, kind: "prop" | "backdrop", placementId: string, canvas: Canvas): void {
  if (kind === "prop" && name !== "pro-flash") throw new Error(`--service ${name} is for Backdrops; props are generated on Pro Flash`);
  const size = `${canvas.width}x${canvas.height}`;
  if (name === "pro-flash" && !fitsProFlash(canvas)) {
    throw new Error(`${placementId} is a ${size} Backdrop: Pro Flash draws at most ${PRO_FLASH_MAX_SIDE} px on an axis. Choose another service with --service: ${ALTERNATIVES}`);
  }
  const { minSide, maxSide } = INFO[name];
  if ([canvas.width, canvas.height].some((side) => side < minSide || side > maxSide)) {
    throw new Error(`${placementId} is ${size}: ${name} draws ${minSide} to ${maxSide} px on an axis`);
  }
}

export type Style = { png: Buffer; width: number; height: number };

export type ImageRequest = {
  service: ImageService;
  prompt: string;
  canvas: Canvas;
  seed: number;
  noBackground: boolean;
  palette: { name: string; colours: string[] };
  style: Style | null;
};

export type ImageResult = { png: Buffer; generations: number; meteredUsd: number; params: Record<string, unknown> };

const base64Png = (png: Buffer) => ({ type: "base64" as const, base64: png.toString("base64"), format: "png" as const });

async function palettePng(colours: string[]): Promise<Buffer> {
  const rgb = Buffer.from(colours.flatMap((hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }));
  return sharp(rgb, { raw: { width: colours.length, height: 1, channels: 3 } }).png().toBuffer();
}

function styleFields(style: Style | null, options: typeof STYLE_OPTIONS) {
  if (style === null) return {};
  return {
    style_image: { image: base64Png(style.png), size: { width: style.width, height: style.height }, usage_description: STYLE_USAGE },
    style_options: options,
  };
}

export async function generateImage(req: ImageRequest): Promise<ImageResult> {
  const image_size = req.canvas;
  const target_palette = { colors: req.palette.colours, name: req.palette.name };
  const no_background = req.noBackground;
  if (req.service === "pro-flash") {
    const style = styleFields(req.style, STYLE_OPTIONS);
    const { png, generations } = await createImageProFlash({ description: req.prompt, image_size, seed: req.seed, no_background, target_palette, ...style });
    return { png, generations, meteredUsd: 0, params: { no_background, ...(req.style ? { style_options: STYLE_OPTIONS } : {}) } };
  }
  if (req.service === "pro") {
    // Pro's own palette option would fight target_palette, so the Style anchor lends everything but its colours.
    const options = { ...STYLE_OPTIONS, color_palette: false };
    const { png, generations } = await generateImageV2({ description: req.prompt, image_size, seed: req.seed, no_background, target_palette, ...styleFields(req.style, options) });
    return { png, generations, meteredUsd: 0, params: { no_background, ...(req.style ? { style_options: options } : {}) } };
  }
  const colours = await palettePng(req.palette.colours);
  if (req.service === "pixflux") {
    const { png, generations } = await createImagePixflux({ description: req.prompt, image_size, seed: req.seed, no_background, color_image: base64Png(colours) });
    return { png, generations, meteredUsd: 0, params: { no_background, color_image: req.palette.name } };
  }
  const { value } = await withFreshKey((key) => rdPlusEnvironment(
    { prompt: req.prompt, width: image_size.width, height: image_size.height, seed: req.seed, input_palette: colours.toString("base64") }, key));
  return { png: value.png, generations: 0, meteredUsd: value.costUsd, params: { prompt_style: RD_PLUS_ENVIRONMENT, input_palette: req.palette.name } };
}
