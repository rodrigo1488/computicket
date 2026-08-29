import AppError from "../../errors/AppError";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import { getWbot } from "../../libs/wbot";

const buildCandidateJids = (number: string): string[] => {
  if (number.includes("@")) return [number];

  const cleanNumber = String(number).replace(/\D/g, "");
  const candidates: string[] = [cleanNumber];

  // Brasil: tenta inserir +9 quando o frontend está mandando apenas 12 dígitos.
  if (cleanNumber.startsWith("55") && cleanNumber.length === 12) {
    const ddd = cleanNumber.slice(2, 4);
    const rest = cleanNumber.slice(4); // 8 dígitos
    const withNine = `55${ddd}9${rest}`;
    if (!candidates.includes(withNine)) candidates.push(withNine);
  }

  return candidates.map((n) => `${n}@s.whatsapp.net`);
};

const CheckIsValidContact = async (
  number: string,
  companyId: number
): Promise<void> => {
  const defaultWhatsapp = await GetDefaultWhatsApp(companyId);

  const wbot = getWbot(defaultWhatsapp.id);

  try {
    const candidateJids = buildCandidateJids(number);
    let found = false;

    for (const jid of candidateJids) {
      const [result] = await wbot.onWhatsApp(jid);
      // Baileys pode retornar boolean puro ou um array com object.
      if (result) {
        if (typeof result === "boolean") {
          found = result;
        } else if (typeof (result as any).exists === "boolean") {
          found = (result as any).exists;
        } else {
          found = true;
        }

        if (found) break;
      }
    }

    if (!found) throw new AppError("invalidNumber");
  } catch (err: any) {
    if (err.message === "invalidNumber") {
      throw new AppError("ERR_WAPP_INVALID_CONTACT");
    }
    throw new AppError("ERR_WAPP_CHECK_CONTACT");
  }
};

export default CheckIsValidContact;
