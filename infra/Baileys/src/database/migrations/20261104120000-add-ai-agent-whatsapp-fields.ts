import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Prompts", "canTransferToUser", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    await queryInterface.addColumn("Prompts", "answerFromKnowledge", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    await queryInterface.addColumn("Prompts", "fallbackQueueId", {
      type: DataTypes.INTEGER,
      allowNull: true
    });
    await queryInterface.addColumn("Prompts", "fallbackUserId", {
      type: DataTypes.INTEGER,
      allowNull: true
    });
    await queryInterface.addColumn("Prompts", "idleAlertEnabled", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    await queryInterface.addColumn("Prompts", "idleAlertMinutes", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 30
    });
    await queryInterface.addColumn("Prompts", "idleAlertGroupJid", {
      type: DataTypes.STRING,
      allowNull: true
    });

    await queryInterface.createTable("AiIdleAlerts", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      messageId: {
        type: DataTypes.STRING,
        allowNull: false
      },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false
      }
    });
    await queryInterface.addIndex("AiIdleAlerts", ["ticketId", "messageId"], {
      unique: true,
      name: "ai_idle_alerts_ticket_message_unique"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex("AiIdleAlerts", "ai_idle_alerts_ticket_message_unique");
    await queryInterface.dropTable("AiIdleAlerts");
    await queryInterface.removeColumn("Prompts", "idleAlertGroupJid");
    await queryInterface.removeColumn("Prompts", "idleAlertMinutes");
    await queryInterface.removeColumn("Prompts", "idleAlertEnabled");
    await queryInterface.removeColumn("Prompts", "fallbackUserId");
    await queryInterface.removeColumn("Prompts", "fallbackQueueId");
    await queryInterface.removeColumn("Prompts", "answerFromKnowledge");
    await queryInterface.removeColumn("Prompts", "canTransferToUser");
  }
};
