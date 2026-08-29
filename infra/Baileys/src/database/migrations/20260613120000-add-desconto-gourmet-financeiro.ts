import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("GourmetFinanceiro", "subtotal", {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.addColumn("GourmetFinanceiro", "desconto", {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn("GourmetFinanceiro", "descontoTipo", {
      type: DataTypes.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn("GourmetFinanceiro", "descontoValor", {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("GourmetFinanceiro", "descontoValor");
    await queryInterface.removeColumn("GourmetFinanceiro", "descontoTipo");
    await queryInterface.removeColumn("GourmetFinanceiro", "desconto");
    await queryInterface.removeColumn("GourmetFinanceiro", "subtotal");
  },
};
