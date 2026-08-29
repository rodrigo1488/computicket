import { QueryInterface } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    // Índice único parcial: idUniplus (= codigo UniPlus) único por empresa
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "products_company_idUniplus_unique"
      ON "Products" ("companyId", "idUniplus")
      WHERE "idUniplus" IS NOT NULL AND "idUniplus" <> '';
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS "products_company_idUniplus_unique";
    `);
  },
};
