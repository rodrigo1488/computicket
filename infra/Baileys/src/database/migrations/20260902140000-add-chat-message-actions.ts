import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("ChatMessages", "isDeleted", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    await queryInterface.addColumn("ChatMessages", "isEdited", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    await queryInterface.addColumn("ChatMessages", "quotedMsgId", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "ChatMessages", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("ChatMessages", "quotedMsgId");
    await queryInterface.removeColumn("ChatMessages", "isEdited");
    await queryInterface.removeColumn("ChatMessages", "isDeleted");
  }
};
