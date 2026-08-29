import type * as BaileysNS from "baileys";

type BaileysModule = typeof import("baileys");

let cached: BaileysModule | null = null;
let loading: Promise<BaileysModule> | null = null;

/**
 * tsc com module:commonjs reescreve import() como require().
 * Function() preserva o import() nativo do Node (necessário p/ Baileys ESM).
 */
const nativeImport = new Function(
  "specifier",
  "return import(specifier)"
) as (specifier: string) => Promise<BaileysModule>;

/**
 * Baileys 7+ é ESM-only; o backend compila para CommonJS e não pode
 * usar require("baileys"). Carregar via import() dinâmico nativo.
 */
export const loadBaileys = async (): Promise<BaileysModule> => {
  if (cached) {
    return cached;
  }
  if (!loading) {
    loading = nativeImport("baileys").then(mod => {
      cached = mod;
      return mod;
    });
  }
  return loading;
};

export const getBaileys = (): BaileysModule => {
  if (!cached) {
    throw new Error(
      "Baileys ainda não foi carregado. Chame await loadBaileys() antes."
    );
  }
  return cached;
};

export const isBaileysLoaded = (): boolean => cached != null;

/**
 * Namespace com Proxy: após loadBaileys(), permite baileys.jidNormalizedUser etc.
 * sem require CJS no topo do módulo.
 */
export const baileys: BaileysModule = new Proxy({} as BaileysModule, {
  get(_target, prop, receiver) {
    return Reflect.get(getBaileys() as object, prop, receiver);
  }
}) as BaileysModule;

export type { BaileysNS };
