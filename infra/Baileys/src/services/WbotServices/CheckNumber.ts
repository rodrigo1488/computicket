import AppError from "../../errors/AppError";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import { getWbot } from "../../libs/wbot";
import { logger } from "../../utils/logger";

interface IOnWhatsapp {
  jid: string;
  exists: boolean;
}

const buildCandidateJids = (number: string): string[] => {
  if (number.includes("@")) return [number];

  const cleanNumber = String(number).replace(/\D/g, "");

  const candidates: string[] = [cleanNumber];

  // Brasil (WhatsApp): muitas vezes o número mobile correto tem +9 no meio.
  // Se o frontend está mandando apenas 12 dígitos no formato `55 + DDD + 8`,
  // tentamos inserir o `9` após o DDD -> `55 + DDD + 9 + 8` (13 dígitos).
  if (cleanNumber.startsWith("55") && cleanNumber.length === 12) {
    const ddd = cleanNumber.slice(2, 4);
    const rest = cleanNumber.slice(4); // 8 dígitos
    const withNine = `55${ddd}9${rest}`;
    if (!candidates.includes(withNine)) candidates.push(withNine);
  }

  return candidates.map((n) => `${n}@s.whatsapp.net`);
};

const checker = async (number: string, wbot: any): Promise<IOnWhatsapp | null> => {
  const candidateJids = buildCandidateJids(number);

  for (const jid of candidateJids) {
    const [validNumber] = await wbot.onWhatsApp(jid);
    if (validNumber) return validNumber;
  }

  return null;
};

const CheckContactNumber = async (
  number: string,
  companyId: number
): Promise<IOnWhatsapp> => {
  const defaultWhatsapp = await GetDefaultWhatsApp(companyId);

  const wbot = getWbot(defaultWhatsapp.id);
  const validNumber = await checker(number, wbot);

  if (!validNumber) {
    throw new AppError("ERR_CHECK_NUMBER");
  }
  return validNumber;
};

export default CheckContactNumber;
