import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface.addColumn("ResponseAnswers", "updatedAt", {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    });
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.removeColumn("ResponseAnswers", "updatedAt");
  }
};
