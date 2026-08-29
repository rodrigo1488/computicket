import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.addColumn("Prompts", "canSendInternalMessages", {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
      }),
      queryInterface.addColumn("Prompts", "canTransferToAgent", {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
      }),
      queryInterface.addColumn("Prompts", "transferQueueId", {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Queues", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      })
    ]);
  },

  down: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.removeColumn("Prompts", "canSendInternalMessages"),
      queryInterface.removeColumn("Prompts", "canTransferToAgent"),
      queryInterface.removeColumn("Prompts", "transferQueueId")
    ]);
  }
};

