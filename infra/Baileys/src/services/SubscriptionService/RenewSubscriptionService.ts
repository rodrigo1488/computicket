import Company from "../../models/Company";
import { logger } from "../../utils/logger";

interface RenewalResult {
  success: boolean;
  companyId: number;
  method: "disabled";
  message: string;
  error?: string;
}

/**
 * Renovação automática via gateway de pagamento foi desativada.
 * Não cria mais preferências nem processa Preapproval (Mercado Pago removido).
 */
const RenewSubscriptionService = async (companyId: number): Promise<RenewalResult> => {
  logger.info(
    `RenewSubscriptionService: renovação automática desativada para empresa ${companyId} (gateway removido)`
  );
  return {
    success: false,
    companyId,
    method: "disabled",
    message: "Renovação automática via gateway não está mais disponível",
    error: "Gateway de pagamentos removido",
  };
};

/**
 * Busca empresas que precisam de renovação.
 * Retorna lista vazia: renovação via gateway foi desativada (cron continua sem efeito).
 */
export const findCompaniesNeedingRenewal = async (): Promise<Company[]> => {
  return [];
};

export default RenewSubscriptionService;
