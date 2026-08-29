import { Op } from "sequelize";
import FormResponse from "../models/FormResponse";
import Form from "../models/Form";
import { getBrazilDateString, getBrazilDayBounds } from "./BrazilTimezone";

export async function generateOrderProtocol(
  companyId: number,
  transaction: any
): Promise<string> {
  const now = new Date();
  const { startOfDay, endOfDay } = getBrazilDayBounds(now);
  const dateStr = getBrazilDateString(now);
  const prefix = `PED-${dateStr}-`;
  const last = await FormResponse.findOne({
    attributes: ["protocol"],
    where: {
      protocol: { [Op.like]: `${prefix}%` },
      submittedAt: { [Op.between]: [startOfDay, endOfDay] } as any,
    },
    include: [
      {
        model: Form,
        as: "form",
        required: true,
        where: { companyId },
        attributes: [],
      },
    ],
    order: [["protocol", "DESC"]],
    lock: transaction.LOCK.UPDATE,
    transaction,
  });
  let seq = 1;
  if (last?.protocol) {
    const match = String(last.protocol).match(/-(\d+)$/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}
