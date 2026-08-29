import AppError from "../../errors/AppError";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import {
  FINALIZED_STATUSES,
  HistoryFilters,
  buildClosedTicketsWhere,
  ticketHistoryIncludes,
  serializeSession,
  filterTicketsByAccess
} from "./closedTicketsHistoryHelper";

interface Request {
  contactId: number;
  companyId: number;
  user: HistoryFilters["user"];
}

const ListContactClosedSessionsService = async ({
  contactId,
  companyId,
  user
}: Request): Promise<{ contact: Contact; sessions: ReturnType<typeof serializeSession>[] }> => {
  const contact = await Contact.findOne({
    where: { id: contactId, companyId }
  });

  if (!contact) {
    throw new AppError("ERR_NO_CONTACT_FOUND", 404);
  }

  const whereCondition = await buildClosedTicketsWhere({
    companyId,
    user
  });

  const rows = await Ticket.findAll({
    where: {
      ...(whereCondition as object),
      contactId,
      status: FINALIZED_STATUSES
    },
    include: ticketHistoryIncludes(),
    order: [["updatedAt", "DESC"]]
  });

  const accessible = filterTicketsByAccess(rows, user);

  return {
    contact,
    sessions: accessible.map(serializeSession)
  };
};

export default ListContactClosedSessionsService;
