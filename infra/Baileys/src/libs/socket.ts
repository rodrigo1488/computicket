import { Server as SocketIO } from "socket.io";
import { Server } from "http";
import AppError from "../errors/AppError";
import { logger } from "../utils/logger";
import User from "../models/User";
import Queue from "../models/Queue";
import Ticket from "../models/Ticket";
import { verify } from "jsonwebtoken";
import authConfig from "../config/auth";
import { CounterManager } from "./counter";
import canUserAccessTicket from "../helpers/CanUserAccessTicketQueue";

let io: SocketIO;

// Rate limiting para logs de token expirado — evita spam quando frontend fica em loop de reconexão
const expiredTokenLogThrottle = new Map<string, number>();
const EXPIRED_TOKEN_LOG_INTERVAL_MS = 30000; // Log apenas 1x a cada 30s por token

const shouldLogExpiredToken = (token: string): boolean => {
  if (!token) return true;
  const now = Date.now();
  const lastLog = expiredTokenLogThrottle.get(token);
  if (!lastLog || (now - lastLog) >= EXPIRED_TOKEN_LOG_INTERVAL_MS) {
    expiredTokenLogThrottle.set(token, now);
    // Limpar entradas antigas (> 5 minutos) para não vazar memória
    if (expiredTokenLogThrottle.size > 1000) {
      const fiveMinutesAgo = now - 300000;
      for (const [key, timestamp] of expiredTokenLogThrottle.entries()) {
        if (timestamp < fiveMinutesAgo) {
          expiredTokenLogThrottle.delete(key);
        }
      }
    }
    return true;
  }
  return false;
};

export const initIO = (httpServer: Server): SocketIO => {
  // Configurar CORS para permitir o frontend
  // Quando credentials: true, não podemos usar origin: "*"
  const allowedOrigins = [
    "https://www.compuchat.cloud",
    "https://compuchat.cloud",
    "http://localhost:3000",
    "http://localhost:3001",
    process.env.FRONTEND_URL
  ].filter(Boolean);

  const isDevNetwork =
    process.env.DEV_NETWORK === "true" ||
    process.env.DEV_NETWORK === "1" ||
    process.env.NODE_ENV === "development";

  const isPrivateLanOrigin = (origin: string): boolean => {
    try {
      const { hostname } = new URL(origin);
      if (hostname === "localhost" || hostname === "127.0.0.1") return true;
      if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
      if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
      if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
      return false;
    } catch {
      return false;
    }
  };

  logger.info(`🔧 Socket.IO CORS configurado com origins permitidas:`, allowedOrigins);
  logger.info(`🔧 FRONTEND_URL da env: ${process.env.FRONTEND_URL || "não definido"}`);
  logger.info(`🔧 DEV_NETWORK: ${isDevNetwork ? "enabled" : "disabled"}`);

  io = new SocketIO(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Permitir requisições sem origin (mobile apps, Postman, etc)
        if (!origin) {
          return callback(null, true);
        }

        const isAllowed = allowedOrigins.some(allowed => {
          return origin.includes(String(allowed)) || origin === allowed;
        });

        if (isAllowed || (isDevNetwork && isPrivateLanOrigin(origin))) {
          return callback(null, true);
        }

        console.error(`❌ CORS bloqueado: ${origin} não está na lista de permitidas`);
        console.error(`❌ Origins permitidas:`, allowedOrigins);
        logger.warn(`❌ CORS bloqueado para origin: ${origin}`);
        logger.warn(`❌ Origins permitidas: ${allowedOrigins.join(", ")}`);
        callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"]
    },
    allowEIO3: true,
    transports: ['websocket', 'polling']
  });

  io.on("connection", async socket => {
    const { token } = socket.handshake.query;
    const tokenStr = token as string;
    
    let tokenData = null;
    try {
      tokenData = verify(tokenStr, authConfig.secret);
      logger.debug(tokenData, "io-onConnection: tokenData");
    } catch (error) {
      // Rate limit: log apenas 1x a cada 30s por token para evitar spam em loops de reconexão
      if (shouldLogExpiredToken(tokenStr)) {
        logger.debug(`[libs/socket.ts] Token expirado/inválido (throttled): ${error?.message}`);
      }
      socket.disconnect();
      return io;
    }
    const counters = new CounterManager();

    let user: User = null;
    let userId = tokenData.id;

    if (userId && userId !== "undefined" && userId !== "null") {
      user = await User.findByPk(userId, { include: [ Queue ] });
      if (user) {
        user.online = true;
        await user.save();
      } else {
        logger.info(`onConnect: User ${userId} not found`);
        socket.disconnect();
        return io;
      }
    } else {
      logger.info("onConnect: Missing userId");
      socket.disconnect();
      return io;
    }

    socket.join(`company-${user.companyId}-mainchannel`);
    socket.join(`user-${user.id}`);

    logger.info(`✅ Cliente conectado e autenticado - Socket ID: ${socket.id}, User ID: ${user.id}, Company ID: ${user.companyId}`);

    socket.on("disconnect", (reason) => {
      logger.info(`🔌 Cliente desconectado - Socket ID: ${socket.id}, User ID: ${user.id}, Reason: ${reason}`);
    });

    socket.on("joinChatBox", async (ticketId: string) => {
      if (!ticketId || ticketId === "undefined") {
        return;
      }
      Ticket.findByPk(ticketId).then(
        async (ticket) => {
          if (!ticket || ticket.companyId !== user.companyId) {
            logger.info(`Invalid attempt to join channel of ticket ${ticketId} by user ${user.id}`);
            return;
          }

          const userWithQueues = await User.findByPk(user.id, {
            include: [{ model: Queue, as: "queues" }]
          });

          const mayJoin =
            user.profile === "admin" ||
            canUserAccessTicket(ticket, userWithQueues || user);

          if (mayJoin) {
            let c: number;
            if ((c = counters.incrementCounter(`ticket-${ticketId}`)) === 1) {
              socket.join(ticketId);
            }
            logger.debug(`joinChatbox[${c}]: Channel: ${ticketId} by user ${user.id}`);
          } else {
            logger.info(`Invalid attempt to join channel of ticket ${ticketId} by user ${user.id}`);
          }
        },
        (error) => {
          logger.error(error, `Error fetching ticket ${ticketId}`);
        }
      );
    });
    
    socket.on("leaveChatBox", async (ticketId: string) => {
      if (!ticketId || ticketId === "undefined") {
        return;
      }

      let c: number;
      // o último que sair apaga a luz

      if ((c = counters.decrementCounter(`ticket-${ticketId}`)) === 0) {
        socket.leave(ticketId);
      }
      logger.debug(`leaveChatbox[${c}]: Channel: ${ticketId} by user ${user.id}`)
    });

    socket.on("joinNotification", async () => {
      let c: number;
      if ((c = counters.incrementCounter("notification")) === 1) {
        if (user.profile === "admin") {
          socket.join(`company-${user.companyId}-notification`);
        } else {
          user.queues.forEach((queue) => {
            logger.debug(`User ${user.id} of company ${user.companyId} joined queue ${queue.id} channel.`);
            socket.join(`queue-${queue.id}-notification`);
          });
          if (user.allTicket === "enabled") {
            socket.join("queue-null-notification");
          }

        }
      }
      logger.debug(`joinNotification[${c}]: User: ${user.id}`);
    });
    
    socket.on("leaveNotification", async () => {
      let c: number;
      if ((c = counters.decrementCounter("notification")) === 0) {
        if (user.profile === "admin") {
          socket.leave(`company-${user.companyId}-notification`);
        } else {
          user.queues.forEach((queue) => {
            logger.debug(`User ${user.id} of company ${user.companyId} leaved queue ${queue.id} channel.`);
            socket.leave(`queue-${queue.id}-notification`);
          });
          if (user.allTicket === "enabled") {
            socket.leave("queue-null-notification");
          }
        }
      }
      logger.debug(`leaveNotification[${c}]: User: ${user.id}`);
    });
 
    // Salas por status: admin usa company-${id}-${status}; atendentes usam queue-${queueId}-${status}
    // (o mesmo padrão de emit em UpdateTicketService / wbot). Antes só "pending" fazia join para não-admin —
    // abas "open" e "closed" não recebiam eventos em tempo real.
    const queueTicketStatuses = ["pending", "open", "closed", "group", "rating"];

    socket.on("joinTickets", (status: string) => {
      if (counters.incrementCounter(`status-${status}`) === 1) {
        if (user.profile === "admin") {
          logger.debug(`Admin ${user.id} of company ${user.companyId} joined ${status} tickets channel.`);
          socket.join(`company-${user.companyId}-${status}`);
        } else if (queueTicketStatuses.includes(status)) {
          user.queues.forEach((queue) => {
            logger.debug(`User ${user.id} of company ${user.companyId} joined queue ${queue.id} ${status} tickets channel.`);
            socket.join(`queue-${queue.id}-${status}`);
          });
          if (user.allTicket === "enabled") {
            socket.join(`queue-null-${status}`);
          }
        } else {
          logger.debug(`User ${user.id} cannot subscribe to ${status}`);
        }
      }
    });
    
    socket.on("leaveTickets", (status: string) => {
      if (counters.decrementCounter(`status-${status}`) === 0) {
        if (user.profile === "admin") {
          logger.debug(`Admin ${user.id} of company ${user.companyId} leaved ${status} tickets channel.`);
          socket.leave(`company-${user.companyId}-${status}`);
        } else if (queueTicketStatuses.includes(status)) {
          user.queues.forEach((queue) => {
            logger.debug(`User ${user.id} of company ${user.companyId} leaved queue ${queue.id} ${status} tickets channel.`);
            socket.leave(`queue-${queue.id}-${status}`);
          });
          if (user.allTicket === "enabled") {
            socket.leave(`queue-null-${status}`);
          }
        }
      }
    });
    
    socket.emit("ready");
  });
  return io;
};

export const getIO = (): SocketIO => {
  if (!io) {
    throw new AppError("Socket IO not initialized");
  }
  return io;
};
