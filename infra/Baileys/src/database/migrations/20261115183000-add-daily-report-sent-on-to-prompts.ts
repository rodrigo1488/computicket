import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Prompts", "dailyReportSentOn", {
      type: DataTypes.STRING(10),
      allowNull: true
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Prompts", "dailyReportSentOn");
  }
};
