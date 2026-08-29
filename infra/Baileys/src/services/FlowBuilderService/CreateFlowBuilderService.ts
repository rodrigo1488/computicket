import { FlowBuilderModel } from "../../models/FlowBuilder";
import { WebhookModel } from "../../models/Webhook";
import { randomString } from "../../utils/randomCode";
import QueueIntegrations from "../../models/QueueIntegrations";
import { logger } from "../../utils/logger";

interface Request {
  userId: number;
  name: string;
  companyId: number
}

interface Response {
  flow: FlowBuilderModel;
  integration: QueueIntegrations;
}

const CreateFlowBuilderService = async ({
  userId,
  name,
  companyId
}: Request): Promise<Response | string> => {
  try {
    
    const nameExist = await FlowBuilderModel.findOne({
      where: {
        name,
        company_id: companyId
      }
    })


    if(nameExist){
      return 'exist'
    }

    const flow = await FlowBuilderModel.create({
      user_id: userId,
      company_id: companyId,
      name: name,
    });

    logger.info('🔄 FlowBuilder criado, verificando integração...', {
      flowId: flow.id,
      flowName: name,
      companyId
    });

    // Criar ou atualizar integração automaticamente
    const integrationName = `FlowBuilder - ${name}`;
    
    let integration = await QueueIntegrations.findOne({
      where: {
        name: integrationName,
        companyId,
        type: 'flowbuilder'
      }
    });

    if (!integration) {
      integration = await QueueIntegrations.create({
        type: 'flowbuilder',
        name: integrationName,
        projectName: name,
        jsonContent: JSON.stringify({ flowId: flow.id }),
        language: 'pt-BR',
        companyId
      });

      logger.info('✅ Integração FlowBuilder criada automaticamente!', {
        integrationId: integration.id,
        integrationName,
        flowId: flow.id
      });
    } else {
      logger.info('ℹ️ Integração FlowBuilder já existe', {
        integrationId: integration.id,
        integrationName
      });
    }

    logger.info('💡 Para ativar o flowbuilder, vincule a integração ao WhatsApp!', {
      integrationId: integration.id,
      flowId: flow.id,
      message: 'Vá em Configurações do WhatsApp e configure o Fluxo de Boas-vindas'
    });

    return { flow, integration };
  } catch (error) {
    console.error("Erro ao inserir o FlowBuilder:", error);
    logger.error("Erro ao criar FlowBuilder:", error);

    return error
  }
};

export default CreateFlowBuilderService;
