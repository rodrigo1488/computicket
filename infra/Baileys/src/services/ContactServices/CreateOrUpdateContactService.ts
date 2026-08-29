import { getIO } from "../../libs/socket";
import Contact from "../../models/Contact";
import ContactCustomField from "../../models/ContactCustomField";
import { isNil } from "lodash";
import { Op } from "sequelize";
import { logger } from "../../utils/logger";
import CacheInvalidationService from "../CacheServices/CacheInvalidationService";
import {
  isLocalContactProfileUrl,
  isWhatsAppCdnProfileUrl
} from "../../helpers/contactProfilePic";
interface ExtraInfo extends ContactCustomField {
  name: string;
  value: string;
}

interface Request {
  name: string;
  number: string;
  isGroup: boolean;
  email?: string;
  profilePicUrl?: string;
  companyId: number;
  extraInfo?: ExtraInfo[];
  whatsappId?: number;
  userId?: number;
}

const CreateOrUpdateContactService = async ({
  name,
  number: rawNumber,
  profilePicUrl,
  isGroup,
  email = "",
  companyId,
  extraInfo = [],
  whatsappId,
  userId
}: Request): Promise<Contact> => {
  const number = isGroup ? rawNumber : rawNumber.replace(/[^0-9]/g, "");

  // Log removido para reduzir ruído

  const io = getIO();
  let finalName = name;

  // Validação de unicidade de nome (Case Insensitive)
  // Se já existe um contato com esse nome na empresa (e não é o mesmo número), append o número ao nome
  const existingContactWithName = await Contact.findOne({
    where: {
      name: finalName,
      companyId,
      number: { [Op.ne]: number } // Garante que não é o próprio contato (caso de update)
    }
  });

  if (existingContactWithName) {
    finalName = `${finalName} ${number}`;
  }

  // Usar findOrCreate para evitar race conditions
  // Esta operação é atômica e garante que apenas um registro seja criado
  // NOTA: extraInfo é uma associação (hasMany → ContactCustomFields), não pode estar em defaults
  const [contact, created] = await Contact.findOrCreate({
    where: {
      number,
      companyId
    },
    defaults: {
      name: finalName,
      number,
      profilePicUrl,
      email,
      isGroup,
      companyId,
      whatsappId,
      userId: userId || null
    }
  });

  // Log removido para reduzir ruído

  // Se o contato já existia, atualizar os dados
  if (!created) {
    const updateData: any = {};

    // Atualizar foto: nunca sobrescrever URL real (local/CDN) com nopicture
    // vindo do caminho rápido do inbound — o refresh em background grava a local.
    const newPicIsReal = profilePicUrl && !profilePicUrl.includes("nopicture");
    const oldPicIsReal =
      contact.profilePicUrl && !contact.profilePicUrl.includes("nopicture");
    const oldPicIsStale = isWhatsAppCdnProfileUrl(contact.profilePicUrl);

    if (newPicIsReal && (profilePicUrl !== contact.profilePicUrl || oldPicIsStale)) {
      // Preferir foto local nova; se a nova for CDN e já houver local, manter local.
      if (
        isLocalContactProfileUrl(contact.profilePicUrl) &&
        isWhatsAppCdnProfileUrl(profilePicUrl)
      ) {
        // mantém a local existente
      } else {
        updateData.profilePicUrl = profilePicUrl;
      }
    } else if ((!oldPicIsReal || oldPicIsStale) && newPicIsReal) {
      updateData.profilePicUrl = profilePicUrl;
    }
    // newPicIsReal === false (nopicture): não atualiza — preserva local/CDN no banco

    // Atualizar whatsappId apenas se não estiver definido
    if (isNil(contact.whatsappId) && whatsappId) {
      updateData.whatsappId = whatsappId;
    }

    // Atualizar userId se fornecido
    if (userId !== undefined) {
      updateData.userId = userId;
    }

    if (Object.keys(updateData).length > 0) {
      await contact.update(updateData);
    }

    io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-contact`, {
      action: "update",
      contact
    });
  } else {
    // Contato criado com sucesso
    io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-contact`, {
      action: "create",
      contact
    });
  }

  void CacheInvalidationService.onContactChanged(companyId, contact.id);

  return contact;
};

export default CreateOrUpdateContactService;
