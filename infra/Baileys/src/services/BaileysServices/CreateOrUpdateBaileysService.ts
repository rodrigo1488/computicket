import { Chat, Contact } from "baileys";
import Baileys from "../../models/Baileys";
import { isArray } from "lodash";

interface Request {
  whatsappId: number;
  contacts?: Contact[];
  chats?: Chat[];
}

const contactKey = (item: Contact): string =>
  item?.id != null ? String(item.id) : JSON.stringify(item);

const dedupeContacts = (items: Contact[]): Contact[] => {
  const map = new Map<string, Contact>();
  for (const item of items) {
    map.set(contactKey(item), item);
  }
  return Array.from(map.values());
};

const dedupeChats = (items: Chat[]): Chat[] => {
  const map = new Map<string, Chat>();
  for (const item of items) {
    const key =
      (item as { id?: string })?.id != null
        ? String((item as { id?: string }).id)
        : JSON.stringify(item);
    map.set(key, item);
  }
  return Array.from(map.values());
};

const createOrUpdateBaileysService = async ({
  whatsappId,
  contacts,
  chats
}: Request): Promise<Baileys> => {
  const baileysExists = await Baileys.findOne({
    where: { whatsappId }
  });

  if (baileysExists) {
    const getChats = baileysExists.chats
      ? JSON.parse(JSON.stringify(baileysExists.chats))
      : [];
    const getContacts = baileysExists.contacts
      ? JSON.parse(JSON.stringify(baileysExists.contacts))
      : [];

    let mergedChats = isArray(getChats) ? [...getChats] : [];
    let mergedContacts = isArray(getContacts) ? [...getContacts] : [];

    if (chats?.length) {
      mergedChats.push(...chats);
      mergedChats = dedupeChats(mergedChats);
    }

    if (contacts?.length) {
      mergedContacts.push(...contacts);
      mergedContacts = dedupeContacts(mergedContacts);
    }

    const newBaileys = await baileysExists.update({
      chats: JSON.stringify(mergedChats),
      contacts: JSON.stringify(mergedContacts)
    });

    return newBaileys;
  }

  const baileys = await Baileys.create({
    whatsappId,
    contacts: JSON.stringify(contacts),
    chats: JSON.stringify(chats)
  });

  return baileys;
};

export default createOrUpdateBaileysService;
