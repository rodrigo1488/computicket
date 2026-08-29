import Setting from "../../models/Setting";
import { getGeminiApiKey } from "../../config/gemini";

export const GEMINI_API_KEY_SETTING = "geminiApiKey";

export const getCompanyGeminiApiKey = async (
  companyId: number
): Promise<string> => {
  const row = await Setting.findOne({
    where: { companyId, key: GEMINI_API_KEY_SETTING }
  });
  const fromSetting = row?.value?.trim() || "";
  if (fromSetting) {
    return fromSetting;
  }
  return getGeminiApiKey();
};

export const isGeminiConfiguredForCompany = async (
  companyId: number
): Promise<boolean> => {
  const key = await getCompanyGeminiApiKey(companyId);
  return key.length > 0;
};

export const getGeminiKeySource = async (
  companyId: number
): Promise<"company" | "env" | null> => {
  const row = await Setting.findOne({
    where: { companyId, key: GEMINI_API_KEY_SETTING }
  });
  if (row?.value?.trim()) {
    return "company";
  }
  if (getGeminiApiKey()) {
    return "env";
  }
  return null;
};

export const maskGeminiApiKey = (key: string): string => {
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) {
    return "••••••••";
  }
  return `••••••••${trimmed.slice(-4)}`;
};
