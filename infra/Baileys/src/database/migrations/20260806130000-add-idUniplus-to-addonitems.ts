import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("AddOnItems", "idUniplus", {
      type: DataTypes.STRING(20),
      allowNull: true,
    });
    // Índice para lookup por codigo; unicidade por company é enforced no service
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS "addon_items_idUniplus_idx"
      ON "AddOnItems" ("idUniplus")
      WHERE "idUniplus" IS NOT NULL AND "idUniplus" <> '';
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS "addon_items_idUniplus_idx";
    `);
    await queryInterface.removeColumn("AddOnItems", "idUniplus");
  },
};
