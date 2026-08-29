import path from "path";
import fs from "fs";
import { logger } from "../utils/logger";

// Função para validar e obter configuração do Gerencianet
function getGerencianetConfig() {
  // Validar variáveis de ambiente obrigatórias
  const certName = process.env.GERENCIANET_PIX_CERT;
  const clientId = process.env.GERENCIANET_CLIENT_ID;
  const clientSecret = process.env.GERENCIANET_CLIENT_SECRET;

  if (!certName) {
    logger.error("⚠️ GERENCIANET_PIX_CERT não está definida nas variáveis de ambiente!");
    logger.error("Configure a variável GERENCIANET_PIX_CERT com o nome do arquivo de certificado (sem extensão .p12)");
    throw new Error("GERENCIANET_PIX_CERT não configurada");
  }

  if (!clientId) {
    logger.error("⚠️ GERENCIANET_CLIENT_ID não está definida nas variáveis de ambiente!");
    throw new Error("GERENCIANET_CLIENT_ID não configurada");
  }

  if (!clientSecret) {
    logger.error("⚠️ GERENCIANET_CLIENT_SECRET não está definida nas variáveis de ambiente!");
    throw new Error("GERENCIANET_CLIENT_SECRET não configurada");
  }

  // Construir caminho do certificado
  const certPath = path.join(__dirname, `../../certs/${certName}.p12`);

  // Verificar se o arquivo existe
  if (!fs.existsSync(certPath)) {
    logger.error(`⚠️ Arquivo de certificado não encontrado: ${certPath}`);
    logger.error(`Certificado esperado: ${certName}.p12`);
    logger.error(`Diretório de certificados: ${path.join(__dirname, `../../certs/`)}`);
    throw new Error(`Certificado PIX não encontrado: ${certName}.p12`);
  }

  return {
    sandbox: process.env.GERENCIANET_SANDBOX === "true" || false,
    client_id: clientId,
    client_secret: clientSecret,
    pix_cert: certPath
  };
}

// Exportar função que retorna a configuração (lazy loading)
// Isso evita que o erro ocorra na importação do módulo
export default getGerencianetConfig;
