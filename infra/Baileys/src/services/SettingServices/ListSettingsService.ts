import Setting from "../../models/Setting";
import { appCache, CACHE_TTL } from "../../libs/appCache";

interface Request {
  companyId: number;
}

const ListSettingsService = async ({
  companyId
}: Request): Promise<Setting[] | undefined> => {
  const cacheKey = appCache.buildKey("settings", companyId, "all");

  const { value } = await appCache.getOrSet(
    cacheKey,
    CACHE_TTL.settings,
    async () => {
      const settings = await Setting.findAll({
        where: { companyId }
      });
      return settings.map(s => s.get({ plain: true }));
    },
    "settings"
  );

  return value as Setting[];
};

export default ListSettingsService;
