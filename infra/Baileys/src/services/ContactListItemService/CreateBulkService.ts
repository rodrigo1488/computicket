import Contact from "../../models/Contact";
import ContactListItem from "../../models/ContactListItem";
import { logger } from "../../utils/logger";
import CheckContactNumber from "../WbotServices/CheckNumber";

interface BulkData {
  contactIds: number[];
  contactListId: number;
  companyId: number;
}

interface BulkResult {
  created: number;
  skipped: number;
  items: ContactListItem[];
}

const CreateBulkService = async (data: BulkData): Promise<BulkResult> => {
  const { contactIds, contactListId, companyId } = data;

  // Busca os contatos originais
  const contacts = await Contact.findAll({
    where: {
      id: contactIds,
      companyId
    }
  });

  const createdItems: ContactListItem[] = [];
  let skippedCount = 0;

  for (const contact of contacts) {
    try {
      const [record, created] = await ContactListItem.findOrCreate({
        where: {
          number: contact.number,
          companyId,
          contactListId
        },
        defaults: {
          name: contact.name,
          number: contact.number,
          email: contact.email || "",
          companyId,
          contactListId,
          isWhatsappValid: true // Assumimos válido pois já está nos contatos
        }
      });

      if (created) {
        createdItems.push(record);

        // Valida número em background (não bloqueia)
        CheckContactNumber(record.number, companyId)
          .then(response => {
            record.isWhatsappValid = response.exists;
            const number = response.jid.replace(/\D/g, "");
            record.number = number;
            record.save();
          })
          .catch(e => {
            logger.error(`Erro ao validar número ${record.number}: ${e.message}`);
          });
      } else {
        skippedCount++;
      }
    } catch (error) {
      logger.error(`Erro ao criar ContactListItem para contato ${contact.id}: ${error}`);
      skippedCount++;
    }
  }

  return {
    created: createdItems.length,
    skipped: skippedCount,
    items: createdItems
  };
};

export default CreateBulkService;

