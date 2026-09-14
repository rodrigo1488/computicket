import AppError from "../../errors/AppError";
import {
  assertNudgeAllowed,
  NUDGE_COOLDOWN_MS,
  nudgeCooldownKey
} from "../nudgeCooldown";

describe("assertNudgeAllowed", () => {
  it("permite o primeiro nudge e bloqueia o seguinte no cooldown", () => {
    const store = new Map<string, number>();
    const key = nudgeCooldownKey(1, 9);
    const now = 1_000_000;
    assertNudgeAllowed(key, now, store);
    expect(store.get(key)).toBe(now);
    try {
      assertNudgeAllowed(key, now + 1_000, store);
      throw new Error("deveria ter bloqueado");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(429);
      expect((err as AppError).message).toContain("Aguarde");
    }
  });

  it("libera de novo depois do cooldown", () => {
    const store = new Map<string, number>();
    const key = nudgeCooldownKey(2, 4);
    const now = 2_000_000;
    assertNudgeAllowed(key, now, store);
    assertNudgeAllowed(key, now + NUDGE_COOLDOWN_MS, store);
    expect(store.get(key)).toBe(now + NUDGE_COOLDOWN_MS);
  });
});
