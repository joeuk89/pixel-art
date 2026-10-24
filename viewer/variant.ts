import type { ScenePlan, Variant } from "../schema/index.ts";

const PARAM = "variant";

export type VariantHistory = { pushState(state: unknown, unused: string, url: URL): void };

export type VariantSwitch = {
  readonly current: Variant;
  readonly visible: boolean;
  shareUrl(): URL;
  next(): Variant;
};

export type VariantSwitchOptions = {
  plan: Pick<ScenePlan, "variants">;
  url: URL;
  history: VariantHistory;
  onChange?: (variant: Variant) => void;
};

export function variantFromUrl(plan: Pick<ScenePlan, "variants">, url: URL): Variant {
  const wanted = url.searchParams.get(PARAM);
  return plan.variants.find((v) => v.id === wanted) ?? plan.variants[0];
}

export function createVariantSwitch({ plan, url, history, onChange }: VariantSwitchOptions): VariantSwitch {
  let current = variantFromUrl(plan, url);
  const urlOf = (variant: Variant) => {
    const next = new URL(url);
    if (variant === plan.variants[0]) next.searchParams.delete(PARAM);
    else next.searchParams.set(PARAM, variant.id);
    return next;
  };
  return {
    get current() {
      return current;
    },
    visible: plan.variants.length > 1,
    shareUrl: () => urlOf(current),
    next() {
      current = plan.variants[(plan.variants.indexOf(current) + 1) % plan.variants.length];
      history.pushState(null, "", urlOf(current));
      onChange?.(current);
      return current;
    },
  };
}
