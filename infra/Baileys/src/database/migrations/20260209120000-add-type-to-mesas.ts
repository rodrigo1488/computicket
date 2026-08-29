import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface.addColumn("Mesas", "type", {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "mesa",
    });
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.removeColumn("Mesas", "type");
  },
};
