const CLASS = "app-nudge-shake";
const DURATION_MS = 700;

let timer: number | null = null;

export function shakeApp() {
  if (typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const shell = document.getElementById("app-shell");
  const targets = [shell || document.documentElement];
  for (const el of targets) {
    el.classList.remove(CLASS);
    void el.offsetWidth;
    el.classList.add(CLASS);
  }
  try {
    window.navigator.vibrate?.([70, 40, 70, 40, 110]);
  } catch {
    /* sem suporte */
  }
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    for (const el of targets) el.classList.remove(CLASS);
    timer = null;
  }, DURATION_MS);
}
