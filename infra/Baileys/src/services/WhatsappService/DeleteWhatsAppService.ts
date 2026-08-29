import Whatsapp from "../../models/Whatsapp";
import AppError from "../../errors/AppError";
import CloseTicketsByWhatsAppIdService from "../TicketServices/CloseTicketsByWhatsAppIdService";

const DeleteWhatsAppService = async (id: string, companyId: number): Promise<void> => {
  const whatsapp = await Whatsapp.findOne({
    where: { id, companyId }
  });

  if (!whatsapp) {
    throw new AppError("ERR_NO_WAPP_FOUND", 404);
  }

  await CloseTicketsByWhatsAppIdService(whatsapp.id);
  await whatsapp.destroy();
};

export default DeleteWhatsAppService;
