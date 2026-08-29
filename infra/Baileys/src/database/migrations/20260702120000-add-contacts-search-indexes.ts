import { QueryInterface } from "sequelize";

/**
 * Índices para acelerar buscas de contatos por empresa + nome/número.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === "postgres") {
      await queryInterface.sequelize.query(`
        CREATE INDEX IF NOT EXISTS "Contacts_companyId_name_idx"
        ON "Contacts" ("companyId", LOWER("name"));
      `);

      await queryInterface.sequelize.query(`
        CREATE INDEX IF NOT EXISTS "Contacts_companyId_number_idx"
        ON "Contacts" ("companyId", "number");
      `);

      await queryInterface.sequelize.query(`
        CREATE INDEX IF NOT EXISTS "Contacts_companyId_userId_idx"
        ON "Contacts" ("companyId", "userId");
      `);
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === "postgres") {
      await queryInterface.sequelize.query(`
        DROP INDEX IF EXISTS "Contacts_companyId_name_idx";
      `);
      await queryInterface.sequelize.query(`
        DROP INDEX IF EXISTS "Contacts_companyId_number_idx";
      `);
      await queryInterface.sequelize.query(`
        DROP INDEX IF EXISTS "Contacts_companyId_userId_idx";
      `);
    }
  }
};
