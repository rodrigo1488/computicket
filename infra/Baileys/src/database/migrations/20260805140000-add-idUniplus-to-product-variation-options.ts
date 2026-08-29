import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("ProductVariationOptions", "idUniplus", {
      type: DataTypes.STRING(20),
      allowNull: true,
    });
    // Índice para lookup por codigo; unicidade por company é enforced no service
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS "product_variation_options_idUniplus_idx"
      ON "ProductVariationOptions" ("idUniplus")
      WHERE "idUniplus" IS NOT NULL AND "idUniplus" <> '';
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS "product_variation_options_idUniplus_idx";
    `);
    await queryInterface.removeColumn("ProductVariationOptions", "idUniplus");
  },
};
