import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Tickets", "groupAlertStatus", {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null
    });
    await queryInterface.addColumn("Tickets", "groupAlertMessageId", {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null
    });
    await queryInterface.addIndex("Tickets", ["groupAlertStatus"], {
      name: "tickets_group_alert_status"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex("Tickets", "tickets_group_alert_status");
    await queryInterface.removeColumn("Tickets", "groupAlertMessageId");
    await queryInterface.removeColumn("Tickets", "groupAlertStatus");
  }
};
