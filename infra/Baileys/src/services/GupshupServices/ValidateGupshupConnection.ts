import * as Sentry from "@sentry/node";
import { logger } from "../../utils/logger";
import Whatsapp from "../../models/Whatsapp";
import GupshupApiClient from "./GupshupApiClient";
import { getIO } from "../../libs/socket";
import AppError from "../../errors/AppError";
import CloseTicketsByWhatsAppIdService from "../TicketServices/CloseTicketsByWhatsAppIdService";

/**
 * Valida a conexão Gupshup testando as credenciais
 * Faz uma chamada de teste à API para verificar se a API Key e App Name estão corretos
 */
export const ValidateGupshupConnection = async (
  whatsapp: Whatsapp
): Promise<{ valid: boolean; message?: string }> => {
  try {
    if (!whatsapp.gupshupApiKey || !whatsapp.gupshupAppName) {
      logger.warn(`Gupshup validation: Credenciais não configuradas para ${whatsapp.name}`);
      await whatsapp.update({ status: "DISCONNECTED" });
      await CloseTicketsByWhatsAppIdService(whatsapp.id);

      const io = getIO();
      io.to(`company-${whatsapp.companyId}-mainchannel`).emit("whatsappSession", {
        action: "update",
        session: whatsapp
      });
      
      return {
        valid: false,
        message: "Credenciais não configuradas"
      };
    }

    // Fazer uma chamada de teste à API Gupshup
    // Usar o método TestGupshupConnection para validar as credenciais
    try {
      const testResult = await TestGupshupConnection(
        whatsapp.gupshupApiKey,
        whatsapp.gupshupAppName
      );

      if (testResult.valid) {
        await whatsapp.update({ status: "CONNECTED" });
        
        const io = getIO();
        io.to(`company-${whatsapp.companyId}-mainchannel`).emit("whatsappSession", {
          action: "update",
          session: whatsapp
        });
        
        logger.info(`Gupshup validation: Conexão validada para ${whatsapp.name}`);
        
        return {
          valid: true,
          message: testResult.message || "Conexão validada com sucesso"
        };
      } else {
        await whatsapp.update({ status: "DISCONNECTED" });
        await CloseTicketsByWhatsAppIdService(whatsapp.id);

        const io = getIO();
        io.to(`company-${whatsapp.companyId}-mainchannel`).emit("whatsappSession", {
          action: "update",
          session: whatsapp
        });
        
        return {
          valid: false,
          message: testResult.message || "Credenciais inválidas"
        };
      }
    } catch (error: any) {
      logger.error(`Gupshup validation error: ${error.message}`);
      
      // Se for erro de autenticação, marcar como desconectado
      if (error.response?.status === 401 || error.response?.status === 403) {
        await whatsapp.update({ status: "DISCONNECTED" });
        await CloseTicketsByWhatsAppIdService(whatsapp.id);

        const io = getIO();
        io.to(`company-${whatsapp.companyId}-mainchannel`).emit("whatsappSession", {
          action: "update",
          session: whatsapp
        });
        
        return {
          valid: false,
          message: "API Key ou App Name inválidos"
        };
      }
      
      throw error;
    }
  } catch (error: any) {
    Sentry.captureException(error);
    logger.error(`Erro ao validar conexão Gupshup: ${error.message}`);
    
    await whatsapp.update({ status: "DISCONNECTED" });
    await CloseTicketsByWhatsAppIdService(whatsapp.id);

    const io = getIO();
    io.to(`company-${whatsapp.companyId}-mainchannel`).emit("whatsappSession", {
      action: "update",
      session: whatsapp
    });
    
    return {
      valid: false,
      message: error.response?.data?.message || "Erro ao validar conexão"
    };
  }
};

/**
 * Testa a conexão Gupshup fazendo uma chamada real à API
 * Usa um endpoint de validação ou faz uma chamada de teste
 */
export const TestGupshupConnection = async (
  apiKey: string,
  appName: string
): Promise<{ valid: boolean; message?: string }> => {
  try {
    if (!apiKey || !appName) {
      return {
        valid: false,
        message: "API Key e App Name são obrigatórios"
      };
    }

    // Fazer uma chamada de teste à API Gupshup
    // Vamos tentar usar um endpoint que requer autenticação para validar as credenciais
    // A Gupshup API tem endpoints que retornam 401/403 se as credenciais estiverem inválidas
    
    const axios = require("axios");
    const baseURL = "https://api.gupshup.io/wa/api/v1";
    
    try {
      // Tentar acessar um endpoint que requer autenticação
      // Usar o endpoint de templates que é comum e requer autenticação
      // Se as credenciais estiverem corretas, retornará sucesso (mesmo que lista vazia)
      // Se estiverem incorretas, retornará 401/403
      const response = await axios.get(
        `${baseURL}/template/list`,
        {
          headers: {
            apikey: apiKey,
            "Content-Type": "application/json"
          },
          params: {
            appname: appName
          },
          validateStatus: (status: number) => status < 500 // Aceitar 4xx para detectar credenciais inválidas
        }
      );

      // Se retornou 401 ou 403, credenciais inválidas
      if (response.status === 401 || response.status === 403) {
        return {
          valid: false,
          message: "API Key ou App Name inválidos"
        };
      }

      // Se retornou sucesso (200, 204, etc), credenciais são válidas
      return {
        valid: true,
        message: "Conexão validada com sucesso"
      };
    } catch (error: any) {
      // Se for erro de autenticação, credenciais inválidas
      if (error.response?.status === 401 || error.response?.status === 403) {
        return {
          valid: false,
          message: "API Key ou App Name inválidos"
        };
      }

      // Se for erro 404, pode ser que o endpoint não exista, mas as credenciais podem estar corretas
      // Tentar outro método: fazer uma chamada POST vazia ou usar outro endpoint
      if (error.response?.status === 404) {
        // Tentar endpoint alternativo de business profile
        try {
          const altResponse = await axios.get(
            `${baseURL}/app/${appName}/business/profile`,
            {
              headers: {
                apikey: apiKey,
                "Content-Type": "application/json"
              },
              validateStatus: (status: number) => status < 500
            }
          );

          if (altResponse.status === 401 || altResponse.status === 403) {
            return {
              valid: false,
              message: "API Key ou App Name inválidos"
            };
          }

          return {
            valid: true,
            message: "Conexão validada com sucesso"
          };
        } catch (altError: any) {
          if (altError.response?.status === 401 || altError.response?.status === 403) {
            return {
              valid: false,
              message: "API Key ou App Name inválidos"
            };
          }
        }
      }

      // Outros erros podem ser de rede ou API indisponível
      // Se não for erro de autenticação, vamos considerar que as credenciais podem estar corretas
      // mas há um problema de rede ou API
      if (error.response?.status !== 401 && error.response?.status !== 403) {
        return {
          valid: true,
          message: "Credenciais parecem válidas (possível erro de rede ou API)"
        };
      }

      throw error;
    }
  } catch (error: any) {
    logger.error(`Erro ao testar conexão Gupshup: ${error.message}`);
    return {
      valid: false,
      message: error.response?.data?.message || "Erro ao validar conexão"
    };
  }
};

