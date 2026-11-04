import Queue from "../../models/Queue";
import Whatsapp from "../../models/Whatsapp";
import ShowPromptService from "./ShowPromptService";

const DeletePromptService = async (promptId: number | string, companyId: number | string): Promise<void> => {
  const prompt = await ShowPromptService({ promptId, companyId });

  await Queue.update(
    { promptId: null },
    { where: { promptId: prompt.id, companyId: prompt.companyId } }
  );
  await Whatsapp.update(
    { promptId: null },
    { where: { promptId: prompt.id, companyId: prompt.companyId } }
  );
  await prompt.destroy();
};

export default DeletePromptService;
