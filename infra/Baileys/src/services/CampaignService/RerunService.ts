import { addMinutes } from "date-fns";
import AppError from "../../errors/AppError";
import Campaign from "../../models/Campaign";
import CampaignShipping from "../../models/CampaignShipping";
import ContactList from "../../models/ContactList";
import Whatsapp from "../../models/Whatsapp";

export async function RerunService(id: number, scheduledAt?: Date): Promise<Campaign> {
  const campaign = await Campaign.findByPk(id);

  if (!campaign) {
    throw new AppError("ERR_NO_CAMPAIGN_FOUND", 404);
  }

  if (!["FINALIZADA", "CANCELADA"].includes(campaign.status)) {
    throw new AppError(
      "Só é possível rodar novamente campanhas Finalizadas ou Canceladas",
      400
    );
  }

  // Apaga todos os registros de envio para que todos os contatos recebam novamente
  await CampaignShipping.destroy({ where: { campaignId: id } });

  const newScheduledAt = scheduledAt || addMinutes(new Date(), 1);

  await campaign.update({
    status: "PROGRAMADA",
    scheduledAt: newScheduledAt,
    completedAt: null,
    estimatedCompletedAt: null
  });

  await campaign.reload({
    include: [
      { model: ContactList },
      { model: Whatsapp, attributes: ["id", "name"] }
    ]
  });

  return campaign;
}
