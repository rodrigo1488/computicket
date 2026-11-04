import { Op } from "sequelize";
import Whatsapp from "../../models/Whatsapp";
import { getWbot } from "../../libs/wbot";
import { logger } from "../../utils/logger";

export type ParticipatingGroup = {
  id: string;
  name: string;
  number: string;
  whatsappId: number;
  whatsappName: string;
};

export type ParticipatingGroupsResult = {
  groups: ParticipatingGroup[];
  connected: number;
};

const ListParticipatingGroupsService = async (
  companyId: number
): Promise<ParticipatingGroupsResult> => {
  const whatsapps = await Whatsapp.findAll({
    where: { companyId, status: { [Op.not]: null } },
    attributes: ["id", "name", "status"]
  });

  const groups: ParticipatingGroup[] = [];
  let connected = 0;

  for (const whatsapp of whatsapps) {
    let wbot;
    try {
      wbot = getWbot(whatsapp.id);
      connected += 1;
    } catch {
      continue;
    }

    try {
      const participating = await (wbot as any).groupFetchAllParticipating();
      const entries = Object.values(participating || {}) as Array<{ id?: string; subject?: string }>;
      for (const group of entries) {
        const jid = String(group?.id || "");
        if (!jid.endsWith("@g.us")) continue;
        groups.push({
          id: `${whatsapp.id}:${jid}`,
          name: group.subject || jid,
          number: jid,
          whatsappId: whatsapp.id,
          whatsappName: whatsapp.name || `Conexão ${whatsapp.id}`
        });
      }
    } catch (err: any) {
      logger.warn(`ListParticipatingGroups: conexão ${whatsapp.id}: ${err.message}`);
    }
  }

  groups.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return { groups, connected };
};

export default ListParticipatingGroupsService;
