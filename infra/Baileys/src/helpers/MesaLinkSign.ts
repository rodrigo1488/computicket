import crypto from "crypto";

/** Para ativar proteção de link (impedir alterar mesa/empresa na URL), defina MESA_LINK_SECRET no .env */
const SECRET = process.env.MESA_LINK_SECRET || process.env.APP_SECRET || "default-mesa-link-secret-change-in-production";
const ORDER_TOKEN_EXPIRY_SEC = 60 * 60; // 1 hora

function getSecret(): string {
  return SECRET;
}

/** Gera assinatura para link público da mesa (formSlug + mesaId). Quem alterar a URL não terá assinatura válida. */
export function signMesaLink(formSlug: string, mesaId: number): string {
  const payload = `${formSlug}:${mesaId}`;
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

/** Verifica se o token corresponde ao formSlug e mesaId. */
export function verifyMesaLink(formSlug: string, mesaId: number, token: string): boolean {
  if (!token || typeof token !== "string") return false;
  const expected = signMesaLink(formSlug, mesaId);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(token, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Mesa independente do formulário: assinatura só por companyId + mesaId. URL única /mesa/:id?t= */
export function signMesaLinkOnly(companyId: number, mesaId: number): string {
  const payload = `mesa:${companyId}:${mesaId}`;
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

/** Verifica token de link só-mesa (mesas independentes de formulário). */
export function verifyMesaLinkOnly(companyId: number, mesaId: number, token: string): boolean {
  if (!token || typeof token !== "string") return false;
  const expected = signMesaLinkOnly(companyId, mesaId);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(token, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Gera token de pedido (sessão) para essa mesa+form. Usado no submit para garantir que o pedido vai para a mesa correta. */
export function createOrderToken(formId: number, mesaId: number): string {
  const payload = JSON.stringify({
    formId,
    mesaId,
    exp: Math.floor(Date.now() / 1000) + ORDER_TOKEN_EXPIRY_SEC,
  });
  const base = Buffer.from(payload, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(base).digest("base64url");
  return `${base}.${sig}`;
}

interface DecodedOrderToken {
  formId: number;
  mesaId: number;
}

/** Decodifica e valida o orderToken. Retorna { formId, mesaId } ou null se inválido/expirado. */
export function verifyOrderToken(token: string): DecodedOrderToken | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [base, sig] = parts;
  const expectedSig = crypto.createHmac("sha256", getSecret()).update(base).digest("base64url");
  const a = Buffer.from(expectedSig, "utf8");
  const b = Buffer.from(sig, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload: { formId: number; mesaId: number; exp: number };
  try {
    payload = JSON.parse(Buffer.from(base, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload.formId || !payload.mesaId || !payload.exp) return null;
  if (Date.now() / 1000 > payload.exp) return null;
  return { formId: payload.formId, mesaId: payload.mesaId };
}

// --- Token para scan do entregador (pedido delivery - QR único por pedido) ---
const DELIVERY_SCAN_TOKEN_EXPIRY_DAYS = 7;

export interface DecodedDeliveryScanToken {
  companyId: number;
  formId: number;
  formResponseId: number;
}

/** Gera token para o entregador escanear e adicionar pedido à rota. Válido por alguns dias. */
export function createDeliveryScanToken(companyId: number, formId: number, formResponseId: number): string {
  const payload = JSON.stringify({
    companyId,
    formId,
    formResponseId,
    exp: Math.floor(Date.now() / 1000) + DELIVERY_SCAN_TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
  });
  const base = Buffer.from(payload, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(base).digest("base64url");
  return `${base}.${sig}`;
}

/** Valida token de scan do entregador. Retorna { companyId, formId, formResponseId } ou null. */
export function verifyDeliveryScanToken(token: string): DecodedDeliveryScanToken | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [base, sig] = parts;
  const expectedSig = crypto.createHmac("sha256", getSecret()).update(base).digest("base64url");
  const a = Buffer.from(expectedSig, "utf8");
  const b = Buffer.from(sig, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload: { companyId: number; formId: number; formResponseId: number; exp: number };
  try {
    payload = JSON.parse(Buffer.from(base, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload.companyId || !payload.formId || !payload.formResponseId || !payload.exp) return null;
  if (Date.now() / 1000 > payload.exp) return null;
  return {
    companyId: payload.companyId,
    formId: payload.formId,
    formResponseId: payload.formResponseId,
  };
}

// --- Token para acompanhamento público do pedido (página /pedido/:token) ---
const ORDER_TRACKING_TOKEN_EXPIRY_DAYS = 7;

export interface DecodedOrderTrackingToken {
  companyId: number;
  formId: number;
  formResponseId: number;
}

/** Gera token para o cliente acompanhar o status do pedido. */
export function createOrderTrackingToken(companyId: number, formId: number, formResponseId: number): string {
  const payload = JSON.stringify({
    t: "track",
    companyId,
    formId,
    formResponseId,
    exp: Math.floor(Date.now() / 1000) + ORDER_TRACKING_TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
  });
  const base = Buffer.from(payload, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(base).digest("base64url");
  return `${base}.${sig}`;
}

/** Valida token de acompanhamento. Retorna { companyId, formId, formResponseId } ou null. */
export function verifyOrderTrackingToken(token: string): DecodedOrderTrackingToken | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [base, sig] = parts;
  const expectedSig = crypto.createHmac("sha256", getSecret()).update(base).digest("base64url");
  const a = Buffer.from(expectedSig, "utf8");
  const b = Buffer.from(sig, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload: { t: string; companyId: number; formId: number; formResponseId: number; exp: number };
  try {
    payload = JSON.parse(Buffer.from(base, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload.t !== "track" || !payload.companyId || !payload.formId || !payload.formResponseId || !payload.exp) return null;
  if (Date.now() / 1000 > payload.exp) return null;
  return {
    companyId: payload.companyId,
    formId: payload.formId,
    formResponseId: payload.formResponseId,
  };
}

// --- Token para cancelar/reagendar agendamento (link no WhatsApp) ---
const APPOINTMENT_TOKEN_EXPIRY_DAYS = 365;

export interface DecodedAppointmentToken {
  appointmentId: number;
}

/** Gera token para link público de cancelar/reagendar agendamento. */
export function createAppointmentToken(appointmentId: number): string {
  const payload = JSON.stringify({
    appointmentId,
    exp: Math.floor(Date.now() / 1000) + APPOINTMENT_TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
  });
  const base = Buffer.from(payload, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(base).digest("base64url");
  return `${base}.${sig}`;
}

/** Valida token de agendamento. Retorna { appointmentId } ou null. */
export function verifyAppointmentToken(token: string): DecodedAppointmentToken | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [base, sig] = parts;
  const expectedSig = crypto.createHmac("sha256", getSecret()).update(base).digest("base64url");
  const a = Buffer.from(expectedSig, "utf8");
  const b = Buffer.from(sig, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload: { appointmentId: number; exp: number };
  try {
    payload = JSON.parse(Buffer.from(base, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload.appointmentId || !payload.exp) return null;
  if (Date.now() / 1000 > payload.exp) return null;
  return { appointmentId: payload.appointmentId };
}
