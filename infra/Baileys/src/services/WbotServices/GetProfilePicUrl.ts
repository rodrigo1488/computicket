import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import { getWbot } from "../../libs/wbot";
import { fetchAndPersistProfilePic } from "../ContactServices/ContactProfilePicService";
import { fallbackProfilePicUrl } from "../../helpers/contactProfilePic";

const GetProfilePicUrl = async (
  number: string,
  companyId: number
): Promise<string> => {
  const defaultWhatsapp = await GetDefaultWhatsApp(companyId);
  const wbot = getWbot(defaultWhatsapp.id);
  const jid = `${number.replace(/\D/g, "")}@s.whatsapp.net`;

  try {
    const result = await fetchAndPersistProfilePic(
      wbot,
      jid,
      companyId,
      number.replace(/\D/g, "")
    );
    return result.url;
  } catch {
    return fallbackProfilePicUrl();
  }
};

export default GetProfilePicUrl;
