import Appointment from "../../models/Appointment";
import { Op, QueryTypes } from "sequelize";
import sequelize from "../../database";
import { getBrazilDayBounds } from "../../helpers/BrazilTimezone";
import { appCache, CACHE_TTL } from "../../libs/appCache";

export interface AgendamentoStats {
  agendamentosHoje: number;
  agendamentosSemana: number;
  pendentesConfirmacao: number;
  concluidosHoje: number;
  noShowCount: number;
  porStatus: Array<{ status: string; quantidade: number }>;
  porProfissional?: Array<{ nome: string; quantidade: number }>;
}

interface Options {
  companyId: number;
  dateFrom?: Date;
  dateTo?: Date;
}

const AgendamentoStatsService = async (
  companyIdOrOptions: number | Options
): Promise<AgendamentoStats> => {
  const companyId =
    typeof companyIdOrOptions === "number"
      ? companyIdOrOptions
      : companyIdOrOptions.companyId;

  const cacheKey = appCache.buildKey("dashboard", companyId, "agendamento-stats");

  const { value } = await appCache.getOrSet(
    cacheKey,
    CACHE_TTL.warm,
    async () => {
      const now = new Date();
      const { startOfDay: dayStart, endOfDay: dayEnd } = getBrazilDayBounds(now);
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const baseWhere = { companyId };

      const [hoje, semana, pendentes, concluidosHoje, noShowCount, porStatusRows, porProfissionalRows] =
        await Promise.all([
          Appointment.count({
            where: {
              ...baseWhere,
              startTime: { [Op.between]: [dayStart, dayEnd] } as any,
              status: { [Op.in]: ["pending", "confirmed", "completed"] }
            }
          }),
          Appointment.count({
            where: {
              ...baseWhere,
              startTime: { [Op.gte]: weekStart },
              status: { [Op.in]: ["pending", "confirmed", "completed"] }
            }
          }),
          Appointment.count({
            where: { ...baseWhere, status: "pending" }
          }),
          Appointment.count({
            where: {
              ...baseWhere,
              startTime: { [Op.between]: [dayStart, dayEnd] } as any,
              status: "completed"
            }
          }),
          Appointment.count({
            where: {
              ...baseWhere,
              status: "confirmed",
              startTime: { [Op.lt]: now }
            }
          }),
          sequelize.query<{ status: string; quantidade: string }>(
            `
            SELECT status, COUNT(*)::int AS quantidade
            FROM "Appointments"
            WHERE "companyId" = :companyId
            GROUP BY status
          `,
            {
              replacements: { companyId },
              type: QueryTypes.SELECT
            }
          ),
          sequelize.query<{ nome: string; quantidade: string }>(
            `
            SELECT COALESCE(NULLIF(TRIM(u.name), ''), 'Sem nome') AS nome,
                   COUNT(*)::int AS quantidade
            FROM "Appointments" a
            LEFT JOIN "Users" u ON u.id = a."assignedUserId"
            WHERE a."companyId" = :companyId
            GROUP BY u.id, u.name
            ORDER BY quantidade DESC
          `,
            {
              replacements: { companyId },
              type: QueryTypes.SELECT
            }
          )
        ]);

      return {
        agendamentosHoje: hoje,
        agendamentosSemana: semana,
        pendentesConfirmacao: pendentes,
        concluidosHoje: concluidosHoje,
        noShowCount,
        porStatus: porStatusRows.map(row => ({
          status: row.status,
          quantidade: Number(row.quantidade) || 0
        })),
        porProfissional: porProfissionalRows.map(row => ({
          nome: row.nome,
          quantidade: Number(row.quantidade) || 0
        }))
      };
    },
    "dashboard"
  );

  return value;
};

export default AgendamentoStatsService;
