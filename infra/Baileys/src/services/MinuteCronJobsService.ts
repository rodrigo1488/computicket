import { Op } from "sequelize";
import { TransferTicketQueue } from "../wbotTransferTicketQueue";
import CheckRemindersService from "./ReminderServices/CheckRemindersService";
import CheckAgendamentoRemindersService from "./AppointmentServices/CheckAgendamentoRemindersService";
import CheckWaitlistAndNotifyService from "./AppointmentServices/CheckWaitlistAndNotifyService";
import CheckOrderAutoConfirmService from "./OrderServices/CheckOrderAutoConfirmService";
import PrintPedido from "../models/PrintPedido";
import RedispatchPendingUniplusJobsService from "./UniplusServices/RedispatchPendingUniplusJobsService";
import {
  isDbUnavailableError,
  logCronDbUnavailable,
} from "../utils/dbUnavailable";
import { logger } from "../utils/logger";

/**
 * Jobs que rodavam em 6 crons separados no mesmo minuto — unificado para um único pico.
 */
const runMinuteCronJobs = async (): Promise<void> => {
  const jobs: Array<{ name: string; run: () => Promise<void> }> = [
    { name: "TransferTicketQueue", run: TransferTicketQueue },
    { name: "CheckReminders", run: CheckRemindersService },
    {
      name: "CheckAgendamentoReminders",
      run: CheckAgendamentoRemindersService
    },
    { name: "CheckWaitlist", run: CheckWaitlistAndNotifyService },
    { name: "CheckOrderAutoConfirm", run: CheckOrderAutoConfirmService },
    {
      name: "PrintPedidoRevert",
      run: async () => {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
        const [affected] = await PrintPedido.update(
          { status: "pending" },
          {
            where: {
              status: "printing",
              updatedAt: { [Op.lt]: fiveMinAgo }
            }
          }
        );
        if (affected > 0) {
          logger.info(`Reverted ${affected} stuck print job(s) to pending`);
        }
      }
    },
    {
      name: "RedispatchPendingUniplus",
      run: async () => {
        await RedispatchPendingUniplusJobsService();
      }
    }
  ];

  for (const { name, run } of jobs) {
    try {
      await run();
    } catch (error: any) {
      if (isDbUnavailableError(error)) logCronDbUnavailable(name);
      else logger.error(`${name}:`, error);
    }
  }
};

export default runMinuteCronJobs;
