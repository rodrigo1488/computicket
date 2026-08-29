import AppError from "../../errors/AppError";
import Campaign from "../../models/Campaign";
import ContactList from "../../models/ContactList";
import Whatsapp from "../../models/Whatsapp";

interface Request {
  id: number | string;
  companyId: number;
}

const DuplicateService = async ({ id, companyId }: Request): Promise<Campaign> => {
  const originalCampaign = await Campaign.findByPk(id, {
    include: [
      { model: ContactList },
      { model: Whatsapp, attributes: ["id", "name"] }
    ]
  });

  if (!originalCampaign) {
    throw new AppError("ERR_NO_CAMPAIGN_FOUND", 404);
  }

  if (originalCampaign.companyId !== companyId) {
    throw new AppError("Não é possível acessar registros de outra empresa", 403);
  }

  const campaignData: any = originalCampaign.toJSON();
  
  // Remover campos que não devem ser duplicados
  delete campaignData.id;
  delete campaignData.createdAt;
  delete campaignData.updatedAt;
  delete campaignData.completedAt;
  delete campaignData.scheduledAt;
  delete campaignData.contactList;
  delete campaignData.whatsapp;
  delete campaignData.fileList;
  delete campaignData.shipping;

  // Criar nova campanha com status INATIVA
  const newCampaign = await Campaign.create({
    ...campaignData,
    name: `${campaignData.name} (Cópia)`,
    status: "INATIVA",
    companyId,
    scheduledAt: null,
    completedAt: null
  });

  await newCampaign.reload({
    include: [
      { model: ContactList },
      { model: Whatsapp, attributes: ["id", "name"] }
    ]
  });

  return newCampaign;
};

export default DuplicateService;
