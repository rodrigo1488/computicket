import path from "path";
import fs from "fs";
import axios from "axios";
import { cacheLayer } from "../../libs/cache";
import { logger } from "../../utils/logger";
import uploadConfig from "../../config/upload";
import Contact from "../../models/Contact";
import { getIO } from "../../libs/socket";
import CacheInvalidationService from "../CacheServices/CacheInvalidationService";
import {
  fallbackProfilePicUrl,
  isLocalContactProfileUrl,
  isWhatsAppCdnProfileUrl
} from "../../helpers/contactProfilePic";

type WbotProfile = {
  profilePictureUrl: (
    jid: string,
    type?: "preview" | "image",
    timeoutMs?: number
  ) => Promise<string | undefined>;
};

const PROFILE_PIC_THROTTLE_SECONDS = 10 * 60;
/** Evita flood em falhas transitórias sem bloquear retries por 10 min. */
const PROFILE_PIC_RETRY_THROTTLE_SECONDS = 60;
const PROFILE_PIC_QUERY_TIMEOUT_MS = 8000;
const PROFILE_PIC_BACKGROUND_QUERY_TIMEOUT_MS = 5000;

export const getProfilePicThrottleKey = (
  companyId: number,
  number: string
): string =>
  `profilepic:throttle:${companyId}:${number.replace(/\D/g, "")}`;

export const clearProfilePicThrottle = async (
  companyId: number,
  number: string
): Promise<void> => {
  try {
    await cacheLayer.del(getProfilePicThrottleKey(companyId, number));
  } catch (_) {}
};

export const getLocalProfilePicPath = (
  companyId: number,
  number: string
): string => {
  const safeNumber = number.replace(/\D/g, "") || "unknown";
  return path.join(
    uploadConfig.directory,
    "contacts",
    String(companyId),
    `${safeNumber}.jpg`
  );
};

export const getLocalProfilePicPublicUrl = (
  companyId: number,
  number: string
): string => {
  const safeNumber = number.replace(/\D/g, "") || "unknown";
  const base = (process.env.BACKEND_URL || "").replace(/\/$/, "");
  return `${base}/public/contacts/${companyId}/${safeNumber}.jpg`;
};

export const persistProfilePictureFromUrl = async (
  whatsappUrl: string,
  companyId: number,
  number: string
): Promise<string> => {
  const fallback = fallbackProfilePicUrl();
  if (!whatsappUrl || whatsappUrl.includes("nopicture")) {
    return fallback;
  }

  const localPath = getLocalProfilePicPath(companyId, number);
  const publicUrl = getLocalProfilePicPublicUrl(companyId, number);

  try {
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    const response = await axios.get<ArrayBuffer>(whatsappUrl, {
      responseType: "arraybuffer",
      timeout: 8000,
      maxRedirects: 5,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "image/*,*/*"
      },
      validateStatus: status => status === 200
    });
    await fs.promises.writeFile(localPath, Buffer.from(response.data));
    return publicUrl;
  } catch (err: any) {
    logger.debug(
      `[profilePic] falha ao baixar foto (${number}): ${err?.message || err}`
    );
    if (fs.existsSync(localPath)) {
      return publicUrl;
    }
    return fallback;
  }
};

export const shouldRefreshContactProfilePic = (
  profilePicUrl: string | null | undefined,
  companyId: number,
  number: string
): boolean => {
  if (!profilePicUrl || profilePicUrl.includes("nopicture")) {
    return true;
  }
  if (isWhatsAppCdnProfileUrl(profilePicUrl)) {
    return true;
  }
  if (isLocalContactProfileUrl(profilePicUrl)) {
    return !fs.existsSync(getLocalProfilePicPath(companyId, number));
  }
  return false;
};

/** Caminho rápido no processamento de mensagens — nunca bloqueia em rede. */
export const resolveProfilePicForInboundMessage = (
  profilePicUrl: string | null | undefined,
  companyId: number,
  number: string
): string => {
  if (
    profilePicUrl &&
    isLocalContactProfileUrl(profilePicUrl) &&
    fs.existsSync(getLocalProfilePicPath(companyId, number))
  ) {
    return profilePicUrl;
  }
  return fallbackProfilePicUrl();
};

const emitContactProfilePicUpdate = (
  companyId: number,
  contact: Contact
): void => {
  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-contact`, {
    action: "update",
    contact
  });
};

const updateContactProfilePicInDb = async (
  contactId: number,
  companyId: number,
  profilePicUrl: string,
  options?: { forceEmit?: boolean }
): Promise<Contact | null> => {
  const contact = await Contact.findByPk(contactId);
  if (!contact) {
    return null;
  }

  const safeNumber = contact.number.replace(/\D/g, "") || contact.number;
  await clearProfilePicThrottle(companyId, safeNumber);

  const urlChanged = contact.profilePicUrl !== profilePicUrl;
  if (urlChanged) {
    await contact.update({ profilePicUrl });
    await contact.reload();
  }

  void CacheInvalidationService.onContactChanged(companyId, contact.id);
  void CacheInvalidationService.onTicketChanged(companyId);

  if (urlChanged || options?.forceEmit) {
    emitContactProfilePicUpdate(companyId, contact);
  }

  return contact;
};

export type ProfilePicFailReason = "no_photo" | "privacy" | "timeout" | "error";

export type ForceRefreshResult = {
  url: string;
  /** true quando uma foto real foi baixada e gravada no contato */
  updated: boolean;
  /** presente quando updated=false, explica o motivo da falha */
  reason?: ProfilePicFailReason;
};

/**
 * Interpreta o erro lançado pelo Baileys (Boom com código WA em err.data):
 * 404 item-not-found = sem foto; 401/403 not-authorized = privacidade/tctoken.
 */
const classifyProfilePicError = (err: any): ProfilePicFailReason => {
  const waCode = Number(err?.data) || Number(err?.output?.statusCode) || 0;
  const message = String(err?.message || "").toLowerCase();

  if (waCode === 404 || message.includes("item-not-found")) {
    return "no_photo";
  }
  if (
    waCode === 401 ||
    waCode === 403 ||
    message.includes("not-authorized") ||
    message.includes("forbidden")
  ) {
    return "privacy";
  }
  if (message.includes("timed out") || message.includes("timeout")) {
    return "timeout";
  }
  return "error";
};

/**
 * Consulta a URL da foto no WhatsApp tentando "image" (alta resolução) e,
 * em falha que não seja "sem foto", cai para "preview" (padrão do WA Web).
 */
const queryProfilePictureUrl = async (
  wbot: WbotProfile,
  jid: string,
  number: string,
  timeoutMs: number = PROFILE_PIC_QUERY_TIMEOUT_MS
): Promise<{ whatsappUrl?: string; reason?: ProfilePicFailReason }> => {
  try {
    const whatsappUrl = await wbot.profilePictureUrl(jid, "image", timeoutMs);
    if (!whatsappUrl) {
      return { reason: "no_photo" };
    }
    return { whatsappUrl };
  } catch (imageErr: any) {
    const imageReason = classifyProfilePicError(imageErr);
    logger.warn(
      `[profilePic] consulta "image" falhou (${number}, jid=${jid}, waCode=${
        imageErr?.data ?? "?"
      }, reason=${imageReason}): ${imageErr?.message || imageErr}`
    );

    if (imageReason === "no_photo") {
      return { reason: "no_photo" };
    }

    try {
      const previewUrl = await wbot.profilePictureUrl(
        jid,
        "preview",
        timeoutMs
      );
      if (!previewUrl) {
        return { reason: "no_photo" };
      }
      logger.info(
        `[profilePic] fallback "preview" funcionou (${number}, jid=${jid})`
      );
      return { whatsappUrl: previewUrl };
    } catch (previewErr: any) {
      const previewReason = classifyProfilePicError(previewErr);
      logger.warn(
        `[profilePic] consulta "preview" falhou (${number}, jid=${jid}, waCode=${
          previewErr?.data ?? "?"
        }, reason=${previewReason}): ${previewErr?.message || previewErr}`
      );
      return { reason: previewReason };
    }
  }
};

/** Busca foto atual no WhatsApp, ignora cache local e throttle. */
export const forceRefreshContactProfilePic = async (
  wbot: WbotProfile,
  jid: string,
  companyId: number,
  number: string,
  contactId: number
): Promise<ForceRefreshResult> => {
  const fallback = fallbackProfilePicUrl();
  const localPath = getLocalProfilePicPath(companyId, number);

  await clearProfilePicThrottle(companyId, number);

  const { whatsappUrl, reason } = await queryProfilePictureUrl(
    wbot,
    jid,
    number
  );

  if (!whatsappUrl) {
    if (reason === "no_photo") {
      // Contato sem foto: remove arquivo local antigo e grava nopicture
      // no banco para não deixar URL órfã.
      try {
        if (fs.existsSync(localPath)) {
          await fs.promises.unlink(localPath);
        }
      } catch (_) {}
      await updateContactProfilePicInDb(contactId, companyId, fallback);
      return { url: fallback, updated: false, reason };
    }

    // Falha transitória (privacidade/timeout/erro): preserva a foto local
    // existente, se houver.
    if (fs.existsSync(localPath)) {
      return {
        url: getLocalProfilePicPublicUrl(companyId, number),
        updated: false,
        reason
      };
    }
    return { url: fallback, updated: false, reason };
  }

  try {
    // Apaga o arquivo antigo somente com foto nova confirmada no CDN,
    // para o download regravar do zero.
    try {
      if (fs.existsSync(localPath)) {
        await fs.promises.unlink(localPath);
      }
    } catch (_) {}

    const url = await persistProfilePictureFromUrl(
      whatsappUrl,
      companyId,
      number
    );

    if (!url.includes("nopicture")) {
      await updateContactProfilePicInDb(contactId, companyId, url);
      return { url, updated: true };
    }

    // Download falhou e não há arquivo local: grava fallback no banco.
    logger.warn(
      `[profilePic] download da foto falhou apos CDN retornar URL (${number})`
    );
    await updateContactProfilePicInDb(contactId, companyId, fallback);
    return { url: fallback, updated: false, reason: "error" };
  } catch (err: any) {
    logger.warn(
      `[profilePic] refresh manual falhou ao persistir (${number}): ${
        err?.message || err
      }`
    );
    if (fs.existsSync(localPath)) {
      return {
        url: getLocalProfilePicPublicUrl(companyId, number),
        updated: false,
        reason: "error"
      };
    }
    return { url: fallback, updated: false, reason: "error" };
  }
};

export type FetchProfilePicResult = {
  url: string;
  reason?: ProfilePicFailReason;
};

export const fetchAndPersistProfilePic = async (
  wbot: WbotProfile,
  jid: string,
  companyId: number,
  number: string,
  options?: { timeoutMs?: number }
): Promise<FetchProfilePicResult> => {
  const fallback = fallbackProfilePicUrl();
  const localPath = getLocalProfilePicPath(companyId, number);
  const publicUrl = getLocalProfilePicPublicUrl(companyId, number);
  const timeoutMs =
    options?.timeoutMs ?? PROFILE_PIC_BACKGROUND_QUERY_TIMEOUT_MS;

  if (fs.existsSync(localPath)) {
    return { url: publicUrl };
  }

  const { whatsappUrl, reason } = await queryProfilePictureUrl(
    wbot,
    jid,
    number,
    timeoutMs
  );

  if (!whatsappUrl) {
    if (fs.existsSync(localPath)) {
      return { url: publicUrl, reason };
    }
    return { url: fallback, reason: reason || "error" };
  }

  const url = await persistProfilePictureFromUrl(
    whatsappUrl,
    companyId,
    number
  );

  if (url.includes("nopicture")) {
    if (fs.existsSync(localPath)) {
      return { url: publicUrl, reason: "error" };
    }
    return { url: fallback, reason: "error" };
  }

  return { url };
};

const applyProfilePicThrottle = async (
  companyId: number,
  number: string,
  seconds: number
): Promise<void> => {
  try {
    await cacheLayer.set(
      getProfilePicThrottleKey(companyId, number),
      "1",
      "EX",
      seconds
    );
  } catch (_) {}
};

const refreshContactProfilePicInBackground = async (
  wbot: WbotProfile,
  jid: string,
  companyId: number,
  number: string,
  contactId?: number
): Promise<void> => {
  const throttleKey = getProfilePicThrottleKey(companyId, number);
  try {
    const throttled = await cacheLayer.get(throttleKey);
    if (throttled) {
      return;
    }
  } catch (_) {}

  const { url, reason } = await fetchAndPersistProfilePic(
    wbot,
    jid,
    companyId,
    number
  );

  if (!url.includes("nopicture")) {
    if (contactId) {
      await updateContactProfilePicInDb(contactId, companyId, url);
    } else {
      const contact = await Contact.findOne({ where: { companyId, number } });
      if (contact) {
        await updateContactProfilePicInDb(contact.id, companyId, url);
      }
    }
    // Reaplica após updateContactProfilePicInDb (que limpa o throttle).
    await applyProfilePicThrottle(
      companyId,
      number,
      PROFILE_PIC_THROTTLE_SECONDS
    );
    return;
  }

  // Sucesso definitivo negativo: não adianta retry imediato.
  if (reason === "no_photo" || reason === "privacy") {
    await applyProfilePicThrottle(
      companyId,
      number,
      PROFILE_PIC_THROTTLE_SECONDS
    );
    logger.warn(
      `[profilePic] background sem foto persistente (${number}, jid=${jid}, reason=${reason})`
    );
    return;
  }

  // timeout/error: throttle curto para evitar flood, mas permite retry logo.
  await applyProfilePicThrottle(
    companyId,
    number,
    PROFILE_PIC_RETRY_THROTTLE_SECONDS
  );
  logger.warn(
    `[profilePic] background falhou de forma transitória (${number}, jid=${jid}, reason=${
      reason || "error"
    })`
  );
};

/** Atualiza foto em background para não atrasar messages.upsert. */
export const scheduleContactProfilePicRefresh = (
  wbot: WbotProfile,
  jid: string,
  companyId: number,
  number: string,
  contactId?: number
): void => {
  setImmediate(() => {
    refreshContactProfilePicInBackground(
      wbot,
      jid,
      companyId,
      number,
      contactId
    ).catch(err => {
      logger.warn(
        `[profilePic] refresh em background falhou (${number}, jid=${jid}): ${
          err?.message || err
        }`
      );
    });
  });
};
