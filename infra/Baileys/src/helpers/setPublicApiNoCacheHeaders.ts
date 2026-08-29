import { Response } from "express";

/** Evita que navegadores/CDN guardem JSON de cardápio/formulário público (horários, settings). */
export function setPublicApiNoCacheHeaders(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}
