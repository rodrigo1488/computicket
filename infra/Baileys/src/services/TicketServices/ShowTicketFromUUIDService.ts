import Ticket from "../../models/Ticket";
import AppError from "../../errors/AppError";
import Contact from "../../models/Contact";
import User from "../../models/User";
import Queue from "../../models/Queue";
import Tag from "../../models/Tag";
import Whatsapp from "../../models/Whatsapp";
import { parseTicketRouteIdentifier } from "../../utils/ticketIdentifier";

const ShowTicketUUIDService = async (uuid: string, companyId: number): Promise<Ticket> => {
  const lookup = parseTicketRouteIdentifier(uuid);
  if (!lookup) {
    throw new AppError(
      "Identificador de ticket inválido (use UUID ou ID numérico)",
      400
    );
  }

  const ticket = await Ticket.findOne({
    where: {
      [lookup.field]: lookup.value,
      companyId
    },
    include: [
      {
        model: Contact,
        as: "contact",
        attributes: ["id", "name", "number", "email", "profilePicUrl"],
        include: ["extraInfo"]
      },
      {
        model: User,
        as: "user",
        attributes: ["id", "name"]
      },
      {
        model: Queue,
        as: "queue",
        attributes: ["id", "name", "color"]
      },
      {
        model: Whatsapp,
        as: "whatsapp",
        attributes: ["name"]
      },
      {
        model: Tag,
        as: "tags",
        attributes: ["id", "name", "color"]
      }
    ]
  }); 

  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  // Garantia extra: ticket deve pertencer à empresa do usuário
  if (ticket.companyId !== companyId) {
    throw new AppError("ERR_ACCESS_DENIED_TICKET", 403);
  }

  return ticket;
};

export default ShowTicketUUIDService;
