import UserQuickButton from "../../models/UserQuickButton";

interface Request {
  companyId: number;
  userId: number;
  includeHidden?: boolean;
}

interface Response {
  buttons: UserQuickButton[];
}

const ListUserQuickButtonsService = async ({
  companyId,
  userId,
  includeHidden = false,
}: Request): Promise<Response> => {
  const whereCondition: any = {
    companyId,
    userId,
  };

  if (!includeHidden) {
    whereCondition.isVisible = true;
  }

  const buttons = await UserQuickButton.findAll({
    where: whereCondition,
    order: [["order", "ASC"]],
  });

  return { buttons };
};

export default ListUserQuickButtonsService;
