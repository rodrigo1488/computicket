import axios from "axios";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";

interface IVerifyProps {
    token: string;
}

const VerifyInstagram = async ({ token }: IVerifyProps): Promise<boolean> => {
    try {
        // Validar se o token está presente e não está vazio
        if (!token || typeof token !== "string" || token.trim().length === 0) {
            throw new AppError("Token do Instagram não pode estar vazio");
        }

        // Validar formato básico do token (deve ter pelo menos alguns caracteres)
        if (token.length < 10) {
            throw new AppError("Token do Instagram parece estar em formato inválido");
        }

        // Validar o token verificando se ele tem permissões para acessar a API do Instagram
        // Usamos /me/permissions para verificar se o token é válido e tem as permissões necessárias
        const url = `https://graph.facebook.com/v18.0/me/permissions`;
        const response = await axios.get(url, {
            params: {
                access_token: token.trim()
            }
        });

        // Verificar se o token tem permissões básicas
        if (!response.data || !response.data.data) {
            throw new AppError("Token do Instagram não possui permissões válidas");
        }

        // Verificar se tem permissão para mensagens do Instagram
        const hasInstagramPermission = response.data.data.some(
            (perm: any) => perm.permission === "instagram_basic" || perm.permission === "instagram_manage_messages"
        );

        if (!hasInstagramPermission) {
            logger.warn("Token do Instagram pode não ter todas as permissões necessárias");
        }

        return true;
    } catch (err: any) {
        // Se o erro for de autenticação, o Facebook retorna detalhes
        if (err.response?.data?.error) {
            const errorMsg = err.response.data.error.message || "Token inválido";
            const errorCode = err.response.data.error.code;
            logger.error(`Erro na validação do Instagram: ${errorMsg} (Code: ${errorCode})`);
            throw new AppError(`Erro na validação do Instagram: ${errorMsg}`);
        }
        
        // Se não houver resposta, pode ser problema de conexão ou token malformado
        if (err.message) {
            logger.error(`Erro ao validar token do Instagram: ${err.message}`);
            throw new AppError(`Falha ao validar token do Instagram: ${err.message}`);
        }
        
        throw new AppError("Falha ao validar token do Instagram. Verifique a conexão e o token.");
    }
};

export default VerifyInstagram;
