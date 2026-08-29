import { Server as HttpServer } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { Op } from "sequelize";
import PrintDevice from "../models/PrintDevice";
import PrintPedido from "../models/PrintPedido";
import { logger } from "../utils/logger";
import HandlePrintJobAckService from "../services/PrintJobService/HandlePrintJobAckService";
import { dispatchJob } from "../services/PrintJobService/CreateAndDispatchPrintJobService";

interface ConnectionInfo {
  ws: WebSocket;
  companyId: number;
  deviceId: string;
}

const WS_PATH = "/ws/print";
const connections = new Map<string, ConnectionInfo>();

function getConnectionKey(companyId: number, deviceId: string): string {
  return `${companyId}:${deviceId}`;
}

function extractAuthFromRequest(request: import("http").IncomingMessage): {
  token: string | null;
  deviceId: string | null;
} {
  const authHeader = request.headers["authorization"];
  const deviceIdHeader = request.headers["x-device-id"];

  let token: string | null = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  }

  const deviceId =
    typeof deviceIdHeader === "string" ? deviceIdHeader.trim() : null;

  return { token, deviceId };
}

export function initPrintWebSocket(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws: WebSocket, request, connectionInfo: ConnectionInfo) => {
    const { companyId, deviceId } = connectionInfo;
    const key = getConnectionKey(companyId, deviceId);

    logger.info(
      `Print agent connected: companyId=${companyId} deviceId=${deviceId}`
    );

    // Dispatch pending jobs for this device
    PrintPedido.findAll({
      where: {
        companyId,
        deviceId,
        status: { [Op.in]: ["pending", "printing"] },
        expiresAt: { [Op.gt]: new Date() }
      },
      order: [["createdAt", "ASC"]]
    }).then((jobs) => {
      jobs.forEach((job) => {
        if (job.status === "printing") {
          job.update({ status: "pending" }).then(() => dispatchJob(job));
        } else {
          dispatchJob(job);
        }
      });
    }).catch((err) => {
      logger.error("Error dispatching pending jobs on connect:", err?.message);
    });

    ws.send(
      JSON.stringify({
        event: "ready",
        message: "Connected successfully"
      })
    );

    ws.on("message", async (data: WebSocket.Data) => {
      try {
        const raw = data.toString();
        const msg = JSON.parse(raw);

        if (msg.event === "ack") {
          const jobId = msg.job_id;
          const status = msg.status;
          const message = msg.message;
          const uniplusContaId = msg.uniplusContaId ?? msg.uniplus_conta_id ?? null;
          const uniplusAction = msg.uniplusAction ?? msg.uniplus_action ?? null;
          const uniplusNumeromesa =
            msg.uniplusNumeromesa ?? msg.uniplus_numeromesa ?? null;
          const permanent = msg.permanent === true || msg.error_permanent === true;

          if (!jobId || !status) {
            logger.warn("Invalid ack received: missing job_id or status");
            return;
          }

          await HandlePrintJobAckService({
            jobId,
            status,
            message,
            companyId,
            deviceId,
            uniplusContaId,
            uniplusAction,
            uniplusNumeromesa,
            protocol: msg.protocol ?? null,
            permanent,
          });
        }
      } catch (err: any) {
        logger.error("Error processing WebSocket message:", err?.message);
      }
    });

    ws.on("close", () => {
      if (connections.get(key)?.ws === ws) {
        connections.delete(key);
      }
      logger.info(
        `Print agent disconnected: companyId=${companyId} deviceId=${deviceId}`
      );
    });

    ws.on("error", (err) => {
      logger.error(
        `Print WebSocket error companyId=${companyId} deviceId=${deviceId}:`,
        err?.message
      );
    });
  });

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = request.url?.split("?")[0];
    if (pathname !== WS_PATH) {
      return;
    }

    const { token, deviceId } = extractAuthFromRequest(request);

    if (!token || !deviceId) {
      logger.warn("Print WS upgrade rejected: missing token or X-Device-Id", {
        hasToken: !!token,
        hasDeviceId: !!deviceId,
        tokenLength: token?.length || 0,
        deviceIdLength: deviceId?.length || 0
      });
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // Buscar dispositivo com token e deviceId
    // extractAuthFromRequest já faz trim, então usamos os valores diretamente
    logger.info(`Print WS auth attempt: deviceId="${deviceId}" tokenLength=${token?.length ?? 0}`, {
      deviceId: deviceId || "null",
      tokenLength: token?.length || 0,
      tokenPreview: token ? token.substring(0, 20) + "..." : "null"
    });
    
    PrintDevice.findOne({
      where: { 
        token: token,
        deviceId: deviceId
      }
    })
      .then((device) => {
        if (!device) {
          // Tentar buscar apenas por deviceId para ver se existe
          return PrintDevice.findOne({
            where: { deviceId: deviceId }
          }).then((deviceByDeviceId) => {
            if (deviceByDeviceId) {
              logger.warn(`Print WS upgrade rejected: token mismatch deviceId="${deviceId}"`, {
                deviceId: deviceId || "null",
                tokenReceivedPreview: token ? token.substring(0, 20) + "..." : "null",
                tokenExpectedPreview: deviceByDeviceId.token.substring(0, 20) + "...",
                tokenReceivedLength: token?.length || 0,
                tokenExpectedLength: deviceByDeviceId.token.length,
                hint: `O token no agente não corresponde ao token no banco. DeviceId "${deviceId}" existe, mas o token está incorreto. Copie o token correto do PrintDevice no banco de dados.`
              });
            } else {
              logger.warn(`Print WS upgrade rejected: deviceId not found deviceId="${deviceId}"`, {
                deviceId: deviceId || "null",
                tokenPreview: token ? token.substring(0, 20) + "..." : "null",
                hint: `DeviceId "${deviceId}" não existe no banco de dados. Crie um PrintDevice com este deviceId primeiro.`
              });
            }
            
            // Listar alguns dispositivos disponíveis para debug (sem expor tokens completos)
            return PrintDevice.findAll({
              attributes: ['id', 'deviceId', 'name', 'companyId', 'token'],
              limit: 10
            }).then((devices) => {
              logger.debug("Available devices:", devices.map(d => ({
                id: d.id,
                deviceId: d.deviceId,
                name: d.name,
                companyId: d.companyId,
                tokenPreview: d.token.substring(0, 20) + "...",
                tokenLength: d.token.length
              })));
              
              socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
              socket.destroy();
              return null;
            });
          });
        }
        logger.info("Print WS auth successful:", {
          deviceId: device.deviceId,
          companyId: device.companyId,
          name: device.name
        });
        return device;
      })
      .then((device) => {
        if (!device) {
          return;
        }

        const key = getConnectionKey(device.companyId, device.deviceId);
        const existing = connections.get(key);
        if (existing && existing.ws.readyState === WebSocket.OPEN) {
          existing.ws.close();
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
          const connInfo: ConnectionInfo = {
            ws,
            companyId: device.companyId,
            deviceId: device.deviceId
          };
          connections.set(key, connInfo);
          wss.emit("connection", ws, request, connInfo);
        });
      })
      .catch((err) => {
        logger.error("Print WS auth error:", err?.message);
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
      });
  });

  logger.info(`Print WebSocket server listening on path ${WS_PATH}`);
}

export function sendPrintJob(
  companyId: number,
  deviceId: string,
  job: { id: number; conteudo: object; tipo?: string }
): boolean {
  const key = getConnectionKey(companyId, deviceId);
  const conn = connections.get(key);

  logger.info(`sendPrintJob: Looking for connection with key=${key} (companyId=${companyId}, deviceId=${deviceId})`);
  logger.info(`sendPrintJob: Available connections: ${Array.from(connections.keys()).join(", ")}`);

  if (!conn) {
    logger.warn(`sendPrintJob: No connection found for key=${key} (companyId=${companyId}, deviceId=${deviceId})`);
    return false;
  }

  if (conn.ws.readyState !== WebSocket.OPEN) {
    logger.warn(`sendPrintJob: Connection exists but WebSocket is not OPEN (state=${conn.ws.readyState}) for key=${key}`);
    return false;
  }

  try {
    const event = job.tipo === "uniplus" ? "uniplus_job" : "print_job";
    const message = JSON.stringify({
      event,
      job_id: job.id,
      conteudo: job.conteudo
    });
    logger.info(`sendPrintJob: Sending ${event} ${job.id} to deviceId=${deviceId} via WebSocket (key=${key})`);
    conn.ws.send(message);
    return true;
  } catch (err) {
    logger.error(`sendPrintJob: Error sending job ${job.id} via WebSocket to deviceId=${deviceId}:`, err);
    return false;
  }
}

export function isAgentConnected(companyId: number, deviceId: string): boolean {
  const key = getConnectionKey(companyId, deviceId);
  const conn = connections.get(key);
  return !!conn && conn.ws.readyState === WebSocket.OPEN;
}
