import { Request, Response } from "express";
import { getIO } from "../libs/socket";
import Whatsapp from "../models/Whatsapp";
import { logger } from "../utils/logger";

export const webhookVerify = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const {
        "hub.mode": mode,
        "hub.verify_token": verifyToken,
        "hub.challenge": challenge
    } = req.query;

    // Em produção, isso deve validar contra o token salvo no banco de dados (table Whatsapps)
    // Como a Meta exige 1 url única por app, geralmente definimos um token global ou buscamos qual conexao tem esse token.
    // Simplificação: Vamos aceitar se qualquer conexao ativa tiver esse token.

    try {
        const whatsapp = await Whatsapp.findOne({
            where: { token: verifyToken }
        });

        if (mode === "subscribe" && whatsapp) {
            return res.status(200).send(challenge);
        }
    } catch (err) {
        logger.error(err);
    }

    return res.sendStatus(403);
};

export const webhookEvent = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const { body } = req;

    /*
    Payload Example:
    {
      "object": "instagram",
      "entry": [
        {
          "id": "17841405793187218",
          "time": 1520383571,
          "messaging": [
            {
              "sender": { "id": "1254459154682919" },
              "recipient": { "id": "17841405793187218" },
              "timestamp": 1520383571,
              "message": { "mid": "m_ag..", "text": "Hello" }
            }
          ]
        }
      ]
    }
    */

    if (body.object === "instagram") {
        body.entry.forEach(async (entry: any) => {
            // Obter conexão pelo ID da página/conta (entry.id)
            const whatsapp = await Whatsapp.findOne({ where: { fbPageId: entry.id } });

            if (!whatsapp) {
                logger.warn(`Received Instagram event for unknown page: ${entry.id}`);
                return;
            }

            // Validar que a conexão é realmente do tipo Instagram
            if (whatsapp.type !== "instagram") {
                logger.warn(`Received Instagram event for non-Instagram connection: ${whatsapp.id} (type: ${whatsapp.type})`);
                return;
            }

            // Processamento básico de mensagens
            if (entry.messaging) {
                const HandleInstagramMessageService = require("../services/InstagramServices/HandleInstagramMessageService").default;

                for (const event of entry.messaging) {
                    logger.info(`IG Event: ${JSON.stringify(event)}`);

                    if (event.message && event.message.text) {
                        await HandleInstagramMessageService({
                            messageId: event.message.mid,
                            senderId: event.sender.id,
                            body: event.message.text,
                            timestamp: event.timestamp,
                            isFromMe: false
                        }, whatsapp);
                    }
                }
            }
        });

        return res.status(200).send("EVENT_RECEIVED");
    }

    return res.sendStatus(404);
};
