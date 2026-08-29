import Company from "../../models/Company";
import Plan from "../../models/Plan";
import { appCache, CACHE_TTL } from "../../libs/appCache";

const ShowPlanCompanyService = async (id: string | number): Promise<Company> => {
  const cacheKey = appCache.buildKey("company", id, "plan");

  const { value } = await appCache.getOrSet(
    cacheKey,
    CACHE_TTL.company,
    async () => {
      const company = await Company.findOne({
        where: { id },
        attributes: [
          "id",
          "name",
          "email",
          "status",
          "dueDate",
          "createdAt",
          "phone"
        ],
        order: [["name", "ASC"]],
        include: [
          {
            model: Plan,
            as: "plan",
            attributes: [
              "id",
              "name",
              "users",
              "connections",
              "queues",
              "value",
              "useCampaigns",
              "useSchedules",
              "useInternalChat",
              "useExternalApi",
              "useKanban",
              "useOpenAi",
              "useIntegrations"
            ]
          }
        ]
      });

      return company ? company.get({ plain: true }) : null;
    },
    "company"
  );

  if (!value) {
    return null as unknown as Company;
  }

  return value as unknown as Company;
};

export default ShowPlanCompanyService;
