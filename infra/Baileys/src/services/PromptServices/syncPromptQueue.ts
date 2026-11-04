import Queue from "../../models/Queue";

const syncPromptQueue = async (
  promptId: number,
  queueId: number | null,
  companyId: number
): Promise<void> => {
  await Queue.update({ promptId: null }, { where: { promptId, companyId } });
  if (queueId) {
    await Queue.update({ promptId }, { where: { id: queueId, companyId } });
  }
};

export default syncPromptQueue;
