import { QueryInterface } from "sequelize";

/**
 * Help Desk: cada ciclo de atendimento é um ticket novo.
 * Remove UNIQUE(contactId, companyId, whatsappId) — nome histórico
 * `contactid_companyid_unique` — e passa a permitir vários tickets
 * fechados por contato. Um índice único parcial impede dois tickets
 * abertos/pendentes/em avaliação no mesmo contato+conexão.
 */
const OLD_UNIQUE_NAMES = [
  "contactid_companyid_unique",
  "Tickets_contactId_companyId_whatsappId_key",
  "tickets_contactid_companyid_whatsappid_key"
];

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    const qi = queryInterface.sequelize;

    if (dialect === "postgres") {
      for (const name of OLD_UNIQUE_NAMES) {
        await qi.query(`ALTER TABLE "Tickets" DROP CONSTRAINT IF EXISTS "${name}"`);
        await qi.query(`DROP INDEX IF EXISTS "${name}"`);
      }
      await qi.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "tickets_one_open_per_contact"
        ON "Tickets" ("contactId", "companyId", "whatsappId")
        WHERE status IN ('open', 'pending', 'rating')
      `);
      await qi.query(`
        CREATE INDEX IF NOT EXISTS "tickets_contact_company_whatsapp"
        ON "Tickets" ("contactId", "companyId", "whatsappId")
      `);
      return;
    }

    for (const name of OLD_UNIQUE_NAMES) {
      try {
        await queryInterface.removeConstraint("Tickets", name);
      } catch {
        /* já removida ou era índice */
      }
      try {
        await queryInterface.removeIndex("Tickets", name);
      } catch {
        /* já removido */
      }
    }

    try {
      await queryInterface.addIndex("Tickets", ["contactId", "companyId", "whatsappId"], {
        name: "tickets_contact_company_whatsapp"
      });
    } catch {
      /* já existe */
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    const qi = queryInterface.sequelize;

    if (dialect === "postgres") {
      await qi.query(`DROP INDEX IF EXISTS "tickets_one_open_per_contact"`);
      await qi.query(`DROP INDEX IF EXISTS "tickets_contact_company_whatsapp"`);
      await qi.query(`
        ALTER TABLE "Tickets"
        ADD CONSTRAINT "contactid_companyid_unique"
        UNIQUE ("contactId", "companyId", "whatsappId")
      `);
      return;
    }

    try {
      await queryInterface.removeIndex("Tickets", "tickets_contact_company_whatsapp");
    } catch {
      /* ignore */
    }
    await queryInterface.addConstraint("Tickets", ["contactId", "companyId", "whatsappId"], {
      type: "unique",
      name: "contactid_companyid_unique"
    });
  }
};
