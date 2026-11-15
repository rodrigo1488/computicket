import { Op } from "sequelize";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import { openChatNoticeReachesAll, selectOpenChats } from "./aiAgentActions";

/** Encerra o atendimento aberto citado no grupo, sem mandar nova mensagem ao cliente. */
export async function closeGroupAttendance(input: {
  companyId: number;
  whatsappId: number;
  customerName: string;
}): Promise<string> {
  const name = (input.customerName || "").trim();
  if (name.length < 2 || openChatNoticeReachesAll(name)) return "Qual cliente eu encerro?";
  const tickets = await Ticket.findAll({
    where: {
      companyId: input.companyId,
      whatsappId: input.whatsappId,
      isGroup: false,
      status: { [Op.in]: ["open", "pending"] }
    },
    include: [{ model: Contact, as: "contact", attributes: ["id", "name", "number"] }]
  });
  const choice = selectOpenChats(
    tickets.map(ticket => ({
      ticket,
      name: ticket.contact?.name || "",
      number: ticket.contact?.number || ""
    })),
    name
  );
  if (choice.ambiguous) return `Encontrei mais de um atendimento para ${name}. Me diz qual eu encerro.`;
  const match = choice.matches[0];
  if (!match) return `Não encontrei atendimento aberto de ${name}.`;
  await UpdateTicketService({
    ticketId: match.ticket.id,
    companyId: input.companyId,
    ticketData: { status: "closed", skipComplation: true }
  });
  const shown = (match.ticket.contact?.name || name).trim();
  return `Encerrei o atendimento de ${shown}.`;
}
