import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Prompts", "messageDebounceSeconds", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 4
    });
    await queryInterface.addColumn("Prompts", "responseDelayMinSeconds", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 2
    });
    await queryInterface.addColumn("Prompts", "responseDelayMaxSeconds", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 12
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Prompts", "responseDelayMaxSeconds");
    await queryInterface.removeColumn("Prompts", "responseDelayMinSeconds");
    await queryInterface.removeColumn("Prompts", "messageDebounceSeconds");
  }
};
