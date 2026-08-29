import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("PrintPedidos", "tipo", {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "print",
    });
    await queryInterface.addColumn("PrintPedidos", "uniplusContaId", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn("PrintPedidos", "externalRef", {
      type: DataTypes.STRING(40),
      allowNull: true,
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("PrintPedidos", "externalRef");
    await queryInterface.removeColumn("PrintPedidos", "uniplusContaId");
    await queryInterface.removeColumn("PrintPedidos", "tipo");
  },
};
