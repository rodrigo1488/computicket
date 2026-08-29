import Setting from "../../models/Setting";
import { appCache, CACHE_TTL } from "../../libs/appCache";

interface Request {
  companyId: number;
  key?: string;
}

const ListSettingsServiceOne = async ({
  companyId,
  key
}: Request): Promise<Setting | undefined> => {
  if (!key) {
    return undefined;
  }

  const cacheKey = appCache.buildKey("settings", companyId, `key:${key}`);

  const { value } = await appCache.getOrSet(
    cacheKey,
    CACHE_TTL.settings,
    async () => {
      const setting = await Setting.findOne({
        where: { companyId, key }
      });
      return setting ? setting.get({ plain: true }) : null;
    },
    "settings"
  );

  return (value as Setting | null) || undefined;
};

export default ListSettingsServiceOne;
