import { Op } from "sequelize";
import Mesa from "../../models/Mesa";
import Ticket from "../../models/Ticket";
import FormResponse from "../../models/FormResponse";
import AppError from "../../errors/AppError";

interface Request {
  mesaId: number;
  companyId: number;
}

const LiberarMesaService = async ({
  mesaId,
  companyId,
}: Request): Promise<Mesa> => {
  const mesa = await Mesa.findOne({
    where: { id: mesaId, companyId },
  });

  if (!mesa) {
    throw new AppError("ERR_MESA_NOT_FOUND", 404);
  }

  if (mesa.sessionId) {
    await FormResponse.update(
      { orderStatus: "faturado" },
      { where: { mesaSessionId: mesa.sessionId, orderStatus: { [Op.ne]: "faturado" } } }
    );
  }

  if (mesa.ticketId) {
    const ticket = await Ticket.findOne({
      where: { id: mesa.ticketId, companyId },
    });
    if (ticket && ticket.status !== "closed") {
      await ticket.update({ status: "closed" });
    }
  }

  mesa.status = "livre";
  mesa.contactId = null;
  mesa.ticketId = null;
  mesa.occupiedAt = null;
  mesa.sessionId = null;
  await mesa.save();

  return mesa;
};

export default LiberarMesaService;
