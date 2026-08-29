import * as Sentry from "@sentry/node";
import type { WASocket, WAVersion } from "baileys";

import Whatsapp from "../models/Whatsapp";
import { logger } from "../utils/logger";
import pino from "pino";
import authState from "../helpers/authState";
import { Boom } from "@hapi/boom";
import AppError from "../errors/AppError";
import { getIO } from "./socket";
import { Store } from "./store";
import { StartWhatsAppSession } from "../services/WbotServices/StartWhatsAppSession";
import DeleteBaileysService from "../services/BaileysServices/DeleteBaileysService";
import CloseTicketsByWhatsAppIdService from "../services/TicketServices/CloseTicketsByWhatsAppIdService";
import NodeCache from 'node-cache';
import { loadBaileys } from "./baileysModule";

// Usar pino diretamente ao invés de path interno do Baileys (compatível com Baileys 7.x)
const loggerBaileys = pino({ 
  level: "error",
  transport: process.env.NODE_ENV === "development" ? {
    target: "pino-pretty",
    options: { colorize: true }
  } : undefined
});

type Session = WASocket & {
  id?: number;
  store?: Store;
};

const sessions: Session[] = [];

const retriesQrCodeMap = new Map<number, number>();

// Mapa para rastrear sessões em processo de inicialização
const initializingSessions = new Map<number, boolean>();

// Mapa para contagem de reconexões por sessão (backoff exponencial)
const reconnectAttemptsMap = new Map<number, number>();

// Cache da versão do Baileys — buscada apenas uma vez por processo,
// evitando uma requisição HTTP externa a cada reconexão de sessão.
let baileysVersionCache: { version: WAVersion; isLatest: boolean } | null = null;

const getBaileysVersion = async () => {
  if (baileysVersionCache) return baileysVersionCache;
  const { fetchLatestBaileysVersion } = await loadBaileys();
  baileysVersionCache = await fetchLatestBaileysVersion();
  return baileysVersionCache;
};

export const getWbot = (whatsappId: number): Session => {
  const sessionIndex = sessions.findIndex(s => s.id === whatsappId);

  if (sessionIndex === -1) {
    throw new AppError("ERR_WAPP_NOT_INITIALIZED");
  }
  return sessions[sessionIndex];
};

export const removeWbot = async (
  whatsappId: number,
  isLogout = true
): Promise<void> => {
  try {
    const sessionIndex = sessions.findIndex(s => s.id === whatsappId);
    if (sessionIndex !== -1) {
      // Limpar flag de listeners registrados
      if (sessions[sessionIndex]) {
        (sessions[sessionIndex] as any).__listenersRegistered = false;
      }
      
      if (isLogout) {
        sessions[sessionIndex].logout();
        sessions[sessionIndex].ws.close();
      }

      sessions.splice(sessionIndex, 1);
    }
  } catch (err) {
    logger.error(err);
  }
};

export const initWASocket = async (whatsapp: Whatsapp): Promise<Session> => {
  return new Promise(async (resolve, reject) => {
    try {
      (async () => {
        const io = getIO();

        const whatsappUpdate = await Whatsapp.findOne({
          where: { id: whatsapp.id }
        });

        if (!whatsappUpdate) return;

        const activeWhatsapp = whatsappUpdate;
        const { id, name, provider } = activeWhatsapp;

        // Verificar se já existe uma sessão ativa
        const existingSession = sessions.find(s => s.id === id);
        if (existingSession) {
          logger.info(`Sessão ${name} já existe. Retornando sessão existente.`);
          resolve(existingSession as Session);
          return;
        }

        // Verificar se já está em processo de inicialização
        if (initializingSessions.get(id)) {
          logger.warn(`Sessão ${name} já está em processo de inicialização. Aguardando...`);
          // Aguardar até 10 segundos para a inicialização completar
          let attempts = 0;
          while (initializingSessions.get(id) && attempts < 20) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const session = sessions.find(s => s.id === id);
            if (session) {
              resolve(session as Session);
              return;
            }
            attempts++;
          }
          logger.warn(`Timeout aguardando inicialização da sessão ${name}.`);
        }

        // Marcar como em inicialização
        initializingSessions.set(id, true);

        const {
          default: makeWASocket,
          Browsers,
          DisconnectReason,
          makeCacheableSignalKeyStore,
          isJidBroadcast
        } = await loadBaileys();

        const { version, isLatest } = await getBaileysVersion();
        const isLegacy = provider === "stable" ? true : false;

        logger.info(`using WA v${version.join(".")}, isLatest: ${isLatest}`);
        logger.info(`isLegacy: ${isLegacy}`);
        logger.info(`Starting session ${name}`);
        let retriesQrCode = 0;

        let wsocket: Session = null;
        // const store = makeInMemoryStore({
        //   logger: loggerBaileys
        // });

        // Usa sempre o registro mais recente vindo do banco para evitar auth stale.
        const { state, saveState } = await authState(activeWhatsapp);

        const msgRetryCounterCache = new NodeCache();

        wsocket = makeWASocket({
          logger: loggerBaileys,
          printQRInTerminal: false,
          browser: Browsers.appropriate("Desktop"),
          auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
          },
          version,
          // defaultQueryTimeoutMs: 60000,
          retryRequestDelayMs: 250, // espera entre tentativas de reenvio de mensagens falhas
          keepAliveIntervalMs: 1000 * 30, // 30s — heartbeat mais frequente para evitar desconexões
          msgRetryCounterCache,
          shouldIgnoreJid: jid => isJidBroadcast(jid),
        });

        // wsocket = makeWASocket({
        //   version,
        //   logger: loggerBaileys,
        //   printQRInTerminal: false,
        //   auth: state as AuthenticationState,
        //   generateHighQualityLinkPreview: false,
        //   shouldIgnoreJid: jid => isJidBroadcast(jid),
        //   browser: ["Chat", "Chrome", "10.15.7"],
        //   patchMessageBeforeSending: (message) => {
        //     const requiresPatch = !!(
        //       message.buttonsMessage ||
        //       // || message.templateMessage
        //       message.listMessage
        //     );
        //     if (requiresPatch) {
        //       message = {
        //         viewOnceMessage: {
        //           message: {
        //             messageContextInfo: {
        //               deviceListMetadataVersion: 2,
        //               deviceListMetadata: {},
        //             },
        //             ...message,
        //           },
        //         },
        //       };
        //     }

        //     return message;
        //   },
        // })

        // Rastrear tempo de conexão para detectar travamentos em "connecting"
        let connectionStartTime: number | null = null;
        const CONNECTION_TIMEOUT_MS = 1000 * 60 * 5; // 5 minutos máximo para conectar

        wsocket.ev.on(
          "connection.update",
          async ({ connection, lastDisconnect, qr }) => {
            logger.info(
              `Socket  ${name} Connection Update ${connection || ""} ${lastDisconnect || ""
              }`
            );

            // Detectar conexões travadas em "connecting"
            if (connection === "connecting") {
              if (connectionStartTime === null) {
                connectionStartTime = Date.now();
              } else {
                const timeConnecting = Date.now() - connectionStartTime;
                if (timeConnecting > CONNECTION_TIMEOUT_MS) {
                  logger.warn({
                    msg: "wbot: Conexão travada em 'connecting' por muito tempo. Forçando reconexão.",
                    whatsappId: id,
                    whatsappName: name,
                    companyId: activeWhatsapp.companyId,
                    timeConnectingMs: timeConnecting
                  });
                  connectionStartTime = null;
                  try {
                    await activeWhatsapp.update({ status: "TIMEOUT" });
                    io.to(`company-${activeWhatsapp.companyId}-mainchannel`).emit(
                      `company-${activeWhatsapp.companyId}-whatsappSession`,
                      {
                        action: "update",
                        session: activeWhatsapp
                      }
                    );
                  } catch (timeoutStatusError) {
                    logger.error({
                      msg: "Erro ao marcar TIMEOUT após connecting travado",
                      whatsappId: id,
                      error: timeoutStatusError
                    });
                  }
                  removeWbot(id, false);
                  // Aguardar antes de reconectar
                  setTimeout(() => {
                    if (!initializingSessions.get(id) && activeWhatsapp.type !== "instagram" && activeWhatsapp.provider !== "gupshup") {
                      StartWhatsAppSession(activeWhatsapp, activeWhatsapp.companyId);
                    }
                  }, 5000);
                  return;
                }
              }
            } else if (connection === "open") {
              connectionStartTime = null; // Reset ao conectar com sucesso
            }

            if (connection === "close") {
              connectionStartTime = null; // Reset ao fechar
              // Limpar flag de inicialização
              initializingSessions.delete(id);

              const disconnectError = lastDisconnect?.error as Boom | undefined;
              const disconnectStatusCode = disconnectError?.output?.statusCode;
              const disconnectErrorMessage =
                disconnectError?.message ??
                (disconnectError?.data ? JSON.stringify(disconnectError.data) : "unknown");

              // Incrementar contador de reconexões para backoff exponencial
              const currentAttempts = reconnectAttemptsMap.get(id) ?? 0;

              if (disconnectStatusCode === 403) {
                // Conta banida/proibida — limpar sessão, NÃO reconectar (evita loop)
                reconnectAttemptsMap.delete(id);
                logger.warn({
                  msg: `Whatsapp desconectado com 403 (proibido/banido). Limpando sessão sem reconectar.`,
                  whatsappId: id,
                  whatsappName: name,
                  companyId: activeWhatsapp.companyId,
                  disconnectCode: 403,
                  disconnectErrorMessage,
                  disconnectErrorData: disconnectError?.data ?? null
                });
                try {
                  await activeWhatsapp.update({ status: "PENDING", session: "" });
                  await DeleteBaileysService(activeWhatsapp.id);
                  io.to(`company-${activeWhatsapp.companyId}-mainchannel`).emit(`company-${activeWhatsapp.companyId}-whatsappSession`, {
                    action: "update",
                    session: activeWhatsapp
                  });
                } catch (cleanupError) {
                  logger.error({
                    msg: "Erro ao limpar sessão após 403",
                    whatsappId: id,
                    companyId: activeWhatsapp.companyId,
                    disconnectErrorMessage,
                    error: cleanupError
                  });
                }
                removeWbot(id, false);
              } else if (disconnectStatusCode !== DisconnectReason.loggedOut) {
                // Desconexão por rede/timeout/erro transitório — avisar UI e reconectar com backoff
                const nextAttempt = currentAttempts + 1;
                reconnectAttemptsMap.set(id, nextAttempt);
                // Backoff: min(2^n * 1000, 60000) ms → 2s, 4s, 8s, 16s, 32s, 60s (máx)
                const delay = Math.min(Math.pow(2, nextAttempt) * 1000, 60000);
                logger.warn({
                  msg: `Whatsapp desconectado. Reconectando com backoff.`,
                  whatsappId: id,
                  whatsappName: name,
                  companyId: activeWhatsapp.companyId,
                  disconnectCode: disconnectStatusCode ?? "unknown",
                  reconnectAttempt: nextAttempt,
                  delayMs: delay
                });
                try {
                  await activeWhatsapp.update({ status: "TIMEOUT" });
                  io.to(`company-${activeWhatsapp.companyId}-mainchannel`).emit(
                    `company-${activeWhatsapp.companyId}-whatsappSession`,
                    {
                      action: "update",
                      session: activeWhatsapp
                    }
                  );
                } catch (timeoutStatusError) {
                  logger.error({
                    msg: "Erro ao marcar TIMEOUT após desconexão transitória",
                    whatsappId: id,
                    error: timeoutStatusError
                  });
                }
                removeWbot(id, false);
                // Não reconectar se for Instagram ou Gupshup (não usam Baileys)
                setTimeout(
                  () => {
                    if (!initializingSessions.get(id) && activeWhatsapp.type !== "instagram" && activeWhatsapp.provider !== "gupshup") {
                      StartWhatsAppSession(activeWhatsapp, activeWhatsapp.companyId);
                    }
                  },
                  delay
                );
              } else {
                // loggedOut (401) — deslogado pelo WhatsApp, limpar sessão e aguardar novo QR
                reconnectAttemptsMap.delete(id);
                logger.warn({
                  msg: `Whatsapp desconectado por logout (401). Limpando sessão e aguardando novo QR.`,
                  whatsappId: id,
                  whatsappName: name,
                  companyId: activeWhatsapp.companyId,
                  disconnectCode: DisconnectReason.loggedOut
                });
                try {
                  await activeWhatsapp.update({ status: "PENDING", session: "" });
                  await DeleteBaileysService(activeWhatsapp.id);
                  io.to(`company-${activeWhatsapp.companyId}-mainchannel`).emit(`company-${activeWhatsapp.companyId}-whatsappSession`, {
                    action: "update",
                    session: activeWhatsapp
                  });
                } catch (cleanupError) {
                  logger.error({
                    msg: "Erro ao limpar sessão após 401",
                    whatsappId: id,
                    error: cleanupError
                  });
                }
                removeWbot(id, false);
                // Aguardar antes de reconectar para exibir QR de nova autenticação
                // Não reconectar se for Instagram ou Gupshup (não usam Baileys)
                setTimeout(
                  () => {
                    if (!initializingSessions.get(id) && activeWhatsapp.type !== "instagram" && activeWhatsapp.provider !== "gupshup") {
                      StartWhatsAppSession(activeWhatsapp, activeWhatsapp.companyId);
                    }
                  },
                  2000
                );
              }
            }

            if (connection === "open") {
              // Reconectou com sucesso — zerar contador de tentativas
              reconnectAttemptsMap.delete(id);
              await activeWhatsapp.update({
                status: "CONNECTED",
                qrcode: "",
                retries: 0
              });

              io.to(`company-${activeWhatsapp.companyId}-mainchannel`).emit(`company-${activeWhatsapp.companyId}-whatsappSession`, {
                action: "update",
                session: activeWhatsapp
              });

              const sessionIndex = sessions.findIndex(
                s => s.id === activeWhatsapp.id
              );
              if (sessionIndex === -1) {
                wsocket.id = activeWhatsapp.id;
                sessions.push(wsocket);
              }

              // Remover do mapa de inicialização
              initializingSessions.delete(id);
              
              resolve(wsocket);
            }

            if (qr !== undefined) {
              if (retriesQrCodeMap.get(id) && retriesQrCodeMap.get(id) >= 3) {
                await whatsappUpdate.update({
                  status: "DISCONNECTED",
                  qrcode: ""
                });
                await CloseTicketsByWhatsAppIdService(whatsappUpdate.id);
                await DeleteBaileysService(whatsappUpdate.id);
                io.to(`company-${whatsapp.companyId}-mainchannel`).emit(
                  `company-${whatsapp.companyId}-whatsappSession`,
                  {
                    action: "update",
                    session: whatsappUpdate
                  }
                );
                wsocket.ev.removeAllListeners("connection.update");
                wsocket.ws.close();
                wsocket = null;
                retriesQrCodeMap.delete(id);
              } else {
                logger.info(`Session QRCode Generate ${name}`);
                retriesQrCodeMap.set(id, (retriesQrCode += 1));

                await activeWhatsapp.update({
                  qrcode: qr,
                  status: "qrcode",
                  retries: 0
                });
                const sessionIndex = sessions.findIndex(
                  s => s.id === activeWhatsapp.id
                );

                if (sessionIndex === -1) {
                  wsocket.id = activeWhatsapp.id;
                  sessions.push(wsocket);
                }

                io.to(`company-${activeWhatsapp.companyId}-mainchannel`).emit(`company-${activeWhatsapp.companyId}-whatsappSession`, {
                  action: "update",
                  session: activeWhatsapp
                });
              }
            }
          }
        );
        wsocket.ev.on("creds.update", saveState);

        //store.bind(wsocket.ev);
      })();
    } catch (error) {
      // Limpar flag de inicialização em caso de erro
      if (whatsapp?.id) {
        initializingSessions.delete(whatsapp.id);
      }
      Sentry.captureException(error);
      console.log(error);
      reject(error);
    }
  });
};
