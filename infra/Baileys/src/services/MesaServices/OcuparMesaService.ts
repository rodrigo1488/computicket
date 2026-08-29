import { Op } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import Mesa from "../../models/Mesa";
import Ticket from "../../models/Ticket";
import FormResponse from "../../models/FormResponse";
import AppError from "../../errors/AppError";

interface Request {
  mesaId: number;
  companyId: number;
  contactId: number;
  ticketId?: number;
  /** Quando true (ex.: fluxo Garçom), se o contato já estiver em outra mesa, libera a antiga e ocupa a nova */
  transferir?: boolean;
}

const OcuparMesaService = async ({
  mesaId,
  companyId,
  contactId,
  ticketId,
  transferir = false,
}: Request): Promise<Mesa> => {
  const mesa = await Mesa.findOne({
    where: { id: mesaId, companyId },
    include: [{ association: "contact", attributes: ["id", "name", "number"] }],
  });

  if (!mesa) {
    throw new AppError("ERR_MESA_NOT_FOUND", 404);
  }

  if (mesa.status === "ocupada") {
    throw new AppError("ERR_MESA_ALREADY_OCCUPIED", 400);
  }

  const contactIdNum = Number(contactId);
  if (!Number.isFinite(contactIdNum)) {
    throw new AppError("ERR_INVALID_CONTACT", 400);
  }

  // Contato já em outra mesa: buscar por contactId ou por ticketId (mesmo ticket = mesmo atendimento)
  const whereOutra: any = {
    companyId,
    status: "ocupada",
    id: { [Op.ne]: mesaId },
  };
  const byContactOrTicket = [
    { contactId: contactIdNum },
    ...(ticketId && Number.isFinite(Number(ticketId)) ? [{ ticketId: Number(ticketId) }] : []),
  ];
  const outraMesaOcupada = await Mesa.findOne({
    where: {
      ...whereOutra,
      [Op.or]: byContactOrTicket,
    },
    attributes: ["id", "number", "name", "sessionId", "ticketId", "contactId"],
  });

  if (outraMesaOcupada) {
    if (!transferir) {
      throw new AppError("ERR_CONTACT_ALREADY_HAS_MESA", 400);
    }
    const mesaAntiga = outraMesaOcupada as Mesa;
    if (mesaAntiga.sessionId) {
      await FormResponse.update(
        { orderStatus: "faturado" },
        { where: { mesaSessionId: mesaAntiga.sessionId, orderStatus: { [Op.ne]: "faturado" } } }
      );
    }
    if (mesaAntiga.ticketId) {
      const ticket = await Ticket.findOne({
        where: { id: mesaAntiga.ticketId, companyId },
      });
      if (ticket && ticket.status !== "closed") {
        await ticket.update({ status: "closed" });
      }
    }
    await Mesa.update(
      {
        status: "livre",
        contactId: null,
        ticketId: null,
        occupiedAt: null,
        sessionId: null,
      },
      { where: { id: mesaAntiga.id, companyId } }
    );
  }

  const sessionId = uuidv4();
  mesa.status = "ocupada";
  mesa.contactId = contactIdNum;
  mesa.ticketId = ticketId && Number.isFinite(Number(ticketId)) ? Number(ticketId) : null;
  mesa.occupiedAt = new Date();
  mesa.sessionId = sessionId;
  await mesa.save();

  return mesa;
};

export default OcuparMesaService;
