import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("GourmetFinanceiro", "meiosPagamento", {
      type: DataTypes.JSON,
      allowNull: true,
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("GourmetFinanceiro", "meiosPagamento");
  },
};

