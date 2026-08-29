import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Companies", "asaasCustomerId", {
      type: DataTypes.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn("Companies", "asaasSubscriptionId", {
      type: DataTypes.STRING,
      allowNull: true,
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Companies", "asaasCustomerId");
    await queryInterface.removeColumn("Companies", "asaasSubscriptionId");
  },
};
