import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface.sequelize.transaction(async t => {
      await queryInterface.addColumn(
        "Messages",
        "transcription",
        {
          type: DataTypes.TEXT,
          allowNull: true
        },
        { transaction: t }
      );
      await queryInterface.addColumn(
        "Messages",
        "transcriptionStatus",
        {
          type: DataTypes.STRING,
          allowNull: true
        },
        { transaction: t }
      );
      await queryInterface.addColumn(
        "Messages",
        "transcriptionError",
        {
          type: DataTypes.STRING(512),
          allowNull: true
        },
        { transaction: t }
      );
    });
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.sequelize.transaction(async t => {
      await queryInterface.removeColumn("Messages", "transcriptionError", { transaction: t });
      await queryInterface.removeColumn("Messages", "transcriptionStatus", { transaction: t });
      await queryInterface.removeColumn("Messages", "transcription", { transaction: t });
    });
  }
};
