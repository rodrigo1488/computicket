import ListWhatsAppsService from "../WhatsappService/ListWhatsAppsService";
import { StartWhatsAppSession } from "./StartWhatsAppSession";
import * as Sentry from "@sentry/node";
import { logger } from "../../utils/logger";
import {
  canStartAnotherWhatsAppSession,
  registerWhatsAppSessionStarted
} from "../../utils/whatsappShard";

export const StartAllWhatsAppsSessions = async (
  companyId: number
): Promise<void> => {
  try {
    const whatsapps = await ListWhatsAppsService({ companyId });
    if (whatsapps.length > 0) {
      whatsapps.forEach(whatsapp => {
        if (whatsapp.type === "instagram" || whatsapp.provider === "instagram") {
          logger.info(`StartAllWhatsAppsSessions: Skipping Instagram session ${whatsapp.name}`);
          return;
        }
        if (!canStartAnotherWhatsAppSession()) {
          logger.warn(
            `StartAllWhatsAppsSessions: limite WHATSAPP_MAX_SESSIONS_PER_PROCESS atingido — sessão ${whatsapp.name} não iniciada`
          );
          return;
        }
        registerWhatsAppSessionStarted();
        StartWhatsAppSession(whatsapp, companyId);
      });
    }
  } catch (e) {
    Sentry.captureException(e);
  }
};
