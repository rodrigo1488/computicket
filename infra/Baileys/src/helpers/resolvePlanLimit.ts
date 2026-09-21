/**
 * Limite do plano Whaticket, com override por env (USER_LIMIT, CONNECTIONS_LIMIT, QUEUES_LIMIT).
 * No Computicket o motor é embutido: o compose já define 9999, mas o seed antigo
 * gravava 10 e o env era ignorado.
 */
export const resolvePlanLimit = (
  planValue: number | null | undefined,
  envName: string
): number => {
  const raw = process.env[envName];
  if (raw != null && String(raw).trim() !== "") {
    const fromEnv = Number(raw);
    if (Number.isFinite(fromEnv) && fromEnv > 0) {
      return fromEnv;
    }
  }
  const fromPlan = Number(planValue);
  return Number.isFinite(fromPlan) && fromPlan > 0 ? fromPlan : 0;
};
