import Setting from "../models/Setting";
import { isFeatureEnabled } from "./helpdeskAutomationGuards";

export const AUTO_CLOSE_SETTING = "autoCloseEnabled";
export const SECTOR_MENU_SETTING = "sectorMenuEnabled";

export const readCompanyFeature = async (
  companyId: number,
  key: string
): Promise<boolean> => {
  const row = await Setting.findOne({ where: { companyId, key } });
  return isFeatureEnabled(row?.value);
};

export const isAutoCloseEnabled = (companyId: number): Promise<boolean> =>
  readCompanyFeature(companyId, AUTO_CLOSE_SETTING);

export const isSectorMenuEnabled = (companyId: number): Promise<boolean> =>
  readCompanyFeature(companyId, SECTOR_MENU_SETTING);

export const companyIdsWithAutoCloseDisabled = async (): Promise<number[]> => {
  const rows = await Setting.findAll({
    where: { key: AUTO_CLOSE_SETTING, value: "disabled" },
    attributes: ["companyId"]
  });
  return rows.map(row => row.companyId);
};
