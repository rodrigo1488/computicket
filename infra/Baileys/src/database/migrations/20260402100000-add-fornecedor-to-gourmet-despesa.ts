import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("GourmetDespesa", "fornecedor", {
      type: DataTypes.STRING(255),
      allowNull: true,
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("GourmetDespesa", "fornecedor");
  },
};
