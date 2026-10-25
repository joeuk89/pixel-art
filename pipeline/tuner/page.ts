import {
  allPlacements,
  elementRecordSchema,
  paletteSchema,
  featureFile,
  isProjected,
  ROOM_FILE,
  roomLayerOf,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  scenePlanSchema,
  type ElementRecord,
  type Light,
  type Palette,
  type ScenePlan,
} from "../../schema/index.ts";
import { createCompositor, elementPixelsOf, type ElementPixels, type Pixels } from "../../viewer/compositor.ts";
import { fetchJson, fetchOk } from "../../viewer/http.ts";
import { pointOf } from "../../viewer/lighting.ts";
import { startLoop } from "../../viewer/loop.ts";
import { createPrimitives } from "../../viewer/primitives.ts";
import { tuningOf, type PlanTuning } from "../lib/tuning.ts";

type Point = { x: number; y: number };
type PointLight = Extract<Light, { type: "point" }>;
type BeamLight = Extract<Light, { type: "beam" }>;
type Handle = { light: number; corner?: number };

const HIT = 6;
const STYLE = `
  html, body { margin: 0; height: 100%; background: #14101c; color: #e6e0da; font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; }
  body { display: grid; grid-template-columns: 1fr 380px; }
  #stage { display: grid; place-items: center; overflow: hidden; }
  canvas { image-rendering: pixelated; display: block; cursor: crosshair; }
  aside { overflow-y: auto; padding: 12px 14px 40px; background: #1c1726; border-left: 1px solid #3b2f52; }
  h2 { font-size: 13px; margin: 18px 0 6px; color: #f7d35c; }
  fieldset { border: 1px solid #3b2f52; border-radius: 4px; margin: 8px 0; padding: 6px 8px; }
  legend { padding: 0 4px; font-weight: 600; }
  label { display: grid; grid-template-columns: 110px 1fr 64px; gap: 6px; align-items: center; margin: 3px 0; }
  label.check { display: flex; gap: 6px; }
  input[type=number] { width: 60px; }
  input, select, button { font: inherit; }
  button { background: #3b2f52; color: #f6e8cc; border: 0; padding: 4px 10px; border-radius: 4px; cursor: pointer; }
  button.save { background: #f7d35c; color: #14101c; font-weight: 600; padding: 6px 16px; }
  .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 6px 0; }
  .actions { position: sticky; bottom: -40px; background: #1c1726; padding: 8px 0 40px; border-top: 1px solid #3b2f52; }
  [role=status] { white-space: pre-wrap; margin-top: 8px; }
  .error { color: #ff8a80; }
`;

const getJson = (path: string) => fetchJson(new URL(path, location.href));

async function decode(path: string): Promise<Pixels> {
  const bitmap = await createImageBitmap(await (await fetchOk(new URL(path, location.href))).blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

async function boot(): Promise<void> {
  document.head.append(el("style", { textContent: STYLE }));
  const plan = scenePlanSchema.parse(await getJson("scene.json"));
  const palette = paletteSchema.parse(await getJson(`library/palettes/${plan.palette}.json`));
  const companionNames = [...new Set(plan.variants.flatMap((v) => (v.companionPalette ? [v.companionPalette] : [])))];
  const companions = new Map<string, Palette>(
    await Promise.all(companionNames.map(async (name): Promise<[string, Palette]> => [name, paletteSchema.parse(await getJson(`library/palettes/${name}.json`))])),
  );
  const records = new Map<string, ElementRecord>();
  const elements = new Map<string, ElementPixels>();
  await Promise.all(
    [...new Set(allPlacements(plan).map((p) => p.element))].map(async (id) => {
      const record = elementRecordSchema.parse(await getJson(`library/elements/${id}.json`));
      records.set(id, record);
      elements.set(id, await elementPixelsOf(record, (suffix) => decode(`library/elements/${id}${suffix}`)));
    }),
  );
  const room = roomLayerOf(plan) ? await decode(ROOM_FILE) : undefined;
  const features = new Map<string, Pixels>(
    await Promise.all(allPlacements(plan).filter(isProjected).map(async (p): Promise<[string, Pixels]> => [p.id, await decode(featureFile(p.id))])),
  );
  const sizeOf = (id: string) => elements.get(id)?.still;

  const tuning: PlanTuning = structuredClone(tuningOf(plan));
  let selected = 0;

  const canvas = el("canvas", { width: SCENE_WIDTH, height: SCENE_HEIGHT });
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const panel = el("aside");
  const status = el("div");
  status.setAttribute("role", "status");
  document.body.append(el("div", { id: "stage" }, canvas), panel);

  const fit = () => {
    const dpr = devicePixelRatio || 1;
    const stage = canvas.parentElement!;
    const scale = Math.max(1, Math.floor(Math.min((stage.clientWidth * dpr) / SCENE_WIDTH, (stage.clientHeight * dpr) / SCENE_HEIGHT)));
    canvas.style.width = `${(scale * SCENE_WIDTH) / dpr}px`;
    canvas.style.height = `${(scale * SCENE_HEIGHT) / dpr}px`;
  };
  addEventListener("resize", fit);
  fit();

  const tunedPlan = (): ScenePlan => ({ ...plan, dither: tuning.dither, variants: plan.variants.map((v, i) => ({ ...v, ...tuning.variants[i] })) });
  const variantTuning = () => tuning.variants[selected];

  let loop: AbortController | undefined;
  let pending = false;
  const redraw = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const parsed = scenePlanSchema.safeParse(tunedPlan());
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return say(`Not drawn: ${issue.path.join(".")}: ${issue.message}`, true);
      }
      const shown = parsed.data;
      const variant = shown.variants[selected];
      const companion = variant.companionPalette ? companions.get(variant.companionPalette) : undefined;
      const compositor = createCompositor({ plan: shown, elements, palette, variant, companion, room, features, primitives: createPrimitives({ plan: shown, elements, palette, features }) });
      loop?.abort();
      loop = new AbortController();
      let image: ImageData | undefined;
      startLoop(compositor, (frame) => {
        image ??= new ImageData(frame, SCENE_WIDTH, SCENE_HEIGHT);
        ctx.putImageData(image, 0, 0);
      }, loop.signal);
    });
  };

  const say = (text: string, error = false) => {
    status.textContent = text;
    status.className = error ? "error" : "";
  };

  function slider(label: string, value: number, min: number, max: number, step: number, set: (v: number) => void): HTMLLabelElement {
    const range = el("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(value) });
    const number = el("input", { type: "number", step: String(step), value: String(value) });
    range.setAttribute("aria-label", label);
    number.setAttribute("aria-label", `${label} value`);
    const update = (from: HTMLInputElement, to: HTMLInputElement) => {
      const v = Number(from.value);
      if (!Number.isFinite(v)) return;
      to.value = from.value;
      set(v);
      redraw();
    };
    range.addEventListener("input", () => update(range, number));
    number.addEventListener("input", () => update(number, range));
    return el("label", {}, label, range, number);
  }

  function checkbox(label: string, value: boolean, set: (v: boolean) => void, rebuild = false): HTMLLabelElement {
    const box = el("input", { type: "checkbox", checked: value });
    box.addEventListener("change", () => {
      set(box.checked);
      if (rebuild) render();
      redraw();
    });
    return el("label", { className: "check" }, box, label);
  }

  function choice<T extends string>(label: string, value: T, options: readonly { value: T; text: string; colour?: string }[], set: (v: T) => void, rebuild = false): HTMLLabelElement {
    const select = el("select");
    for (const o of options) {
      const option = el("option", { value: o.value, textContent: o.text, selected: o.value === value });
      if (o.colour) option.style.background = o.colour;
      select.append(option);
    }
    select.setAttribute("aria-label", label);
    select.addEventListener("change", () => {
      set(select.value as T);
      if (rebuild) render();
      redraw();
    });
    return el("label", {}, label, select, "");
  }

  const tints = [{ value: "warm", text: "warm" }, { value: "cool", text: "cool" }] as const;
  const colourOptions = palette.colours.map((hex, i) => ({ value: String(i), text: `${i} ${hex}`, colour: hex }));
  const placementIds = allPlacements(plan).map((p) => p.id);

  function anchorPoint(anchor: string): Point {
    return pointOf({ type: "point", id: "probe", anchor, offset: { x: 0, y: 0 }, radius: 1, strength: 0, tint: "warm" }, plan, sizeOf);
  }

  function pointEditor(light: PointLight): Node[] {
    const where = light.anchor ?? "";
    const nodes: Node[] = [
      choice("Anchor", where, [{ value: "", text: "a canvas point" }, ...placementIds.map((id) => ({ value: id, text: id }))], (v) => {
        const at = pointOf(light, plan, sizeOf);
        if (v === "") {
          delete light.anchor;
          delete light.offset;
          light.at = { x: Math.round(at.x), y: Math.round(at.y) };
        } else {
          const base = anchorPoint(v);
          delete light.at;
          light.anchor = v;
          light.offset = { x: Math.round(at.x - base.x), y: Math.round(at.y - base.y) };
        }
      }, true),
    ];
    const position = light.anchor ? (light.offset ??= { x: 0, y: 0 }) : light.at!;
    const word = light.anchor ? "Offset" : "At";
    nodes.push(
      slider(`${word} x`, position.x, -SCENE_WIDTH, SCENE_WIDTH, 1, (v) => (position.x = Math.round(v))),
      slider(`${word} y`, position.y, -SCENE_HEIGHT, SCENE_HEIGHT, 1, (v) => (position.y = Math.round(v))),
      slider("Radius", light.radius, 1, 400, 1, (v) => (light.radius = v)),
      slider("Strength", light.strength, -4, 5, 0.25, (v) => (light.strength = v)),
      choice("Tint", light.tint, tints, (v) => (light.tint = v)),
      checkbox("Flicker", light.flicker !== undefined, (on) => (on ? (light.flicker = { depth: 0.1, rate: 0.8 }) : delete light.flicker), true),
    );
    if (light.flicker) {
      const flicker = light.flicker;
      nodes.push(
        slider("Flicker depth", flicker.depth, 0, 1, 0.01, (v) => (flicker.depth = v)),
        slider("Flicker rate", flicker.rate, 0.05, 5, 0.05, (v) => (flicker.rate = v)),
      );
    }
    nodes.push(checkbox("Halo", light.halo !== undefined, (on) => (on ? (light.halo = { colour: 0, radius: 24, strength: 0.5 }) : delete light.halo), true));
    if (light.halo) {
      const halo = light.halo;
      nodes.push(
        choice("Halo colour", String(halo.colour), colourOptions, (v) => (halo.colour = Number(v))),
        slider("Halo radius", halo.radius, 1, 160, 1, (v) => (halo.radius = v)),
        slider("Halo strength", halo.strength, 0, 2, 0.05, (v) => (halo.strength = v)),
      );
    }
    return nodes;
  }

  function beamEditor(light: BeamLight): Node[] {
    return [
      ...light.corners.flatMap((c, i) => [
        slider(`Corner ${i + 1} x`, c.x, 0, SCENE_WIDTH, 1, (v) => (c.x = Math.round(v))),
        slider(`Corner ${i + 1} y`, c.y, 0, SCENE_HEIGHT, 1, (v) => (c.y = Math.round(v))),
      ]),
      slider("Strength", light.strength, -4, 5, 0.25, (v) => (light.strength = v)),
      choice("Tint", light.tint, tints, (v) => (light.tint = v)),
      slider("Softness", light.softness, 0, 40, 1, (v) => (light.softness = v)),
    ];
  }

  const freshId = (stem: string) => {
    const taken = new Set(variantTuning().lights.map((l) => l.id));
    let n = 1;
    while (taken.has(`${stem}-${n}`)) n++;
    return `${stem}-${n}`;
  };

  function render(): void {
    const v = variantTuning();
    const variantSwitch = choice("Variant", String(selected), plan.variants.map((pv, i) => ({ value: String(i), text: `${pv.title} (${pv.id})` })), (value) => (selected = Number(value)), true);

    const ambient = el("fieldset", {}, el("legend", { textContent: "Ambient" }),
      slider("Level", v.ambient.level, -4, 3, 0.25, (x) => (v.ambient.level = x)),
      ...plan.layers.flatMap((layer) => {
        const offsets = v.ambient.layers;
        const set = offsets?.[layer.name] !== undefined;
        const nodes: Node[] = [checkbox(`${layer.name}: own offset (${layer.plane} Plane otherwise)`, set, (on) => {
          if (on) v.ambient.layers = { ...offsets, [layer.name]: 0 };
          else if (offsets) {
            delete offsets[layer.name];
            if (Object.keys(offsets).length === 0) delete v.ambient.layers;
          }
        }, true)];
        if (set) nodes.push(slider(`${layer.name} offset`, offsets![layer.name], -4, 3, 0.25, (x) => (offsets![layer.name] = x)));
        return nodes;
      }),
    );

    const lights = v.lights.map((light, i) => {
      const remove = el("button", { type: "button", textContent: "Remove" });
      remove.setAttribute("aria-label", `Remove Light ${light.id}`);
      remove.addEventListener("click", () => {
        v.lights.splice(i, 1);
        render();
        redraw();
      });
      const idInput = el("input", { type: "text", value: light.id });
      idInput.setAttribute("aria-label", "Light id");
      idInput.addEventListener("change", () => {
        light.id = idInput.value.trim();
        redraw();
      });
      return el("fieldset", {}, el("legend", { textContent: `${light.type} Light ${light.id}` }),
        el("label", {}, "Id", idInput, remove),
        ...(light.type === "point" ? pointEditor(light) : beamEditor(light)));
    });
    const addPoint = el("button", { type: "button", textContent: "Add point Light" });
    addPoint.addEventListener("click", () => {
      v.lights.push({ type: "point", id: freshId("light"), at: { x: SCENE_WIDTH / 2, y: SCENE_HEIGHT / 2 }, radius: 80, strength: 1.5, tint: "warm" });
      render();
      redraw();
    });
    const addBeam = el("button", { type: "button", textContent: "Add beam" });
    addBeam.addEventListener("click", () => {
      v.lights.push({ type: "beam", id: freshId("beam"), corners: [{ x: 160, y: 40 }, { x: 200, y: 40 }, { x: 240, y: 200 }, { x: 140, y: 200 }], strength: 1, tint: "warm", softness: 6 });
      render();
      redraw();
    });

    const emissive = allPlacements(plan).filter((p) => records.get(p.element)?.emissive?.length).map((p) =>
      checkbox(`${p.id}: Emissive colours on`, !v.emissiveOff.includes(p.id), (on) => {
        v.emissiveOff = on ? v.emissiveOff.filter((id) => id !== p.id) : [...v.emissiveOff, p.id];
      }));

    const saveButton = el("button", { type: "button", className: "save", textContent: "Save" });
    saveButton.addEventListener("click", () => save(saveButton));

    panel.replaceChildren(
      el("h2", { textContent: plan.title }),
      variantSwitch,
      el("h2", { textContent: "Lighting" }),
      ambient,
      ...lights,
      el("div", { className: "bar" }, addPoint, addBeam),
      el("h2", { textContent: "Emissive colours" }),
      ...(emissive.length ? emissive : [el("p", { textContent: "No Placement has Emissive colours." })]),
      el("h2", { textContent: "Scene" }),
      checkbox("Dither", tuning.dither, (on) => (tuning.dither = on)),
      el("div", { className: "actions" }, el("div", { className: "bar" }, saveButton), status),
    );
  }

  async function save(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    say("Saving, then running the preview checks…");
    try {
      const response = await fetch("save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(tuning) });
      const out = await response.json();
      if (response.status !== 200) return say(`Not saved. ${out.error}`, true);
      const poster = out.error ? ` But ${out.error}.` : out.poster ? " Poster rendered again." : "";
      if (out.preview.ok) say(`Saved.${poster} Preview passed: the Scene is ${out.status} and ${out.preview.staged.length} files are staged.`, !out.ok);
      else say(`Saved.${poster} A preview check failed: ${out.preview.failed.join(", ") || out.preview.error}. The Scene is ${out.status}.\n${out.preview.problems.join("\n")}`, true);
    } catch (e) {
      say(`Not saved: ${(e as Error).message}`, true);
    } finally {
      button.disabled = false;
    }
  }

  const sceneAt = (e: PointerEvent): Point => {
    const box = canvas.getBoundingClientRect();
    return { x: Math.floor(((e.clientX - box.left) / box.width) * SCENE_WIDTH), y: Math.floor(((e.clientY - box.top) / box.height) * SCENE_HEIGHT) };
  };

  const handleAt = (p: Point): Handle | undefined => {
    let best: Handle | undefined;
    let nearest = HIT;
    variantTuning().lights.forEach((light, i) => {
      const points = light.type === "point" ? [pointOf(light, plan, sizeOf)] : light.corners;
      points.forEach((q, corner) => {
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d <= nearest) {
          nearest = d;
          best = light.type === "point" ? { light: i } : { light: i, corner };
        }
      });
    });
    return best;
  };

  let dragging: { handle: Handle; from: Point } | undefined;
  canvas.addEventListener("pointerdown", (e) => {
    const from = sceneAt(e);
    const handle = handleAt(from);
    if (!handle) return;
    dragging = { handle, from };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const to = sceneAt(e);
    const dx = to.x - dragging.from.x;
    const dy = to.y - dragging.from.y;
    if (dx === 0 && dy === 0) return;
    const light = variantTuning().lights[dragging.handle.light];
    if (light.type === "beam") {
      const corner = light.corners[dragging.handle.corner!];
      corner.x += dx;
      corner.y += dy;
    } else {
      const position = light.anchor ? (light.offset ??= { x: 0, y: 0 }) : light.at!;
      position.x += dx;
      position.y += dy;
    }
    dragging.from = to;
    redraw();
  });
  const drop = () => {
    if (!dragging) return;
    dragging = undefined;
    render();
  };
  canvas.addEventListener("pointerup", drop);
  canvas.addEventListener("pointercancel", drop);

  render();
  redraw();
}

boot().catch((e) => {
  document.body.textContent = `The Tuner could not start: ${(e as Error).message}`;
  console.error(e);
});
