import sequelize from "./index";
import { logger } from "../utils/logger";

/**
 * Startup-safe (estilo Flask ensure_column): o entrypoint Docker
 * continua mesmo se `db:migrate` falhar. Garante que a UNIQUE antiga
 * `contactid_companyid_unique` não impeça um novo ciclo por contato.
 */
const OLD_UNIQUE_NAMES = [
  "contactid_companyid_unique",
  "Tickets_contactId_companyId_whatsappId_key",
  "tickets_contactid_companyid_whatsappid_key"
];

export async function ensureTicketsAllowMultiplePerContact(): Promise<void> {
  const dialect = sequelize.getDialect();
  try {
    if (dialect === "postgres") {
      for (const name of OLD_UNIQUE_NAMES) {
        await sequelize.query(`ALTER TABLE "Tickets" DROP CONSTRAINT IF EXISTS "${name}"`);
        await sequelize.query(`DROP INDEX IF EXISTS "${name}"`);
      }
      await sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "tickets_one_open_per_contact"
        ON "Tickets" ("contactId", "companyId", "whatsappId")
        WHERE status IN ('open', 'pending', 'rating')
      `);
      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS "tickets_contact_company_whatsapp"
        ON "Tickets" ("contactId", "companyId", "whatsappId")
      `);
    } else if (dialect === "mysql") {
      for (const name of OLD_UNIQUE_NAMES) {
        try {
          await sequelize.query(`ALTER TABLE \`Tickets\` DROP INDEX \`${name}\``);
        } catch {
          /* índice/constraint ausente */
        }
      }
      await sequelize.query(`
        CREATE INDEX tickets_contact_company_whatsapp
        ON Tickets (contactId, companyId, whatsappId)
      `).catch(() => undefined);
    } else {
      for (const name of OLD_UNIQUE_NAMES) {
        try {
          await sequelize.getQueryInterface().removeConstraint("Tickets", name);
        } catch {
          /* ignore */
        }
        try {
          await sequelize.getQueryInterface().removeIndex("Tickets", name);
        } catch {
          /* ignore */
        }
      }
    }
    logger.info("Tickets: UNIQUE (contactId, companyId, whatsappId) removida — múltiplos ciclos por contato");
  } catch (err) {
    logger.warn(
      "ensureTicketsAllowMultiplePerContact: falha não bloqueante",
      (err as Error)?.message || err
    );
  }
}
