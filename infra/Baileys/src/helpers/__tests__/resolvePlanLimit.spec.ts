import { resolvePlanLimit } from "../resolvePlanLimit";

describe("resolvePlanLimit", () => {
  const original = process.env.USER_LIMIT;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.USER_LIMIT;
    } else {
      process.env.USER_LIMIT = original;
    }
  });

  it("usa o valor do plano quando o env não está definido", () => {
    expect(resolvePlanLimit(10, "USER_LIMIT")).toBe(10);
  });

  it("prioriza o env quando ele é um número positivo", () => {
    process.env.USER_LIMIT = "9999";
    expect(resolvePlanLimit(10, "USER_LIMIT")).toBe(9999);
  });

  it("ignora env inválido e cai no plano", () => {
    process.env.USER_LIMIT = "abc";
    expect(resolvePlanLimit(10, "USER_LIMIT")).toBe(10);
  });

  it("retorna 0 quando não há plano nem env", () => {
    expect(resolvePlanLimit(undefined, "USER_LIMIT")).toBe(0);
  });
});
