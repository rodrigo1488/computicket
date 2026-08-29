import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.addColumn("Whatsapps", "gupshupApiKey", {
        type: DataTypes.STRING(255),
        allowNull: true
      }),
      queryInterface.addColumn("Whatsapps", "gupshupAppName", {
        type: DataTypes.STRING(100),
        allowNull: true
      })
    ]);
  },

  down: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.removeColumn("Whatsapps", "gupshupApiKey"),
      queryInterface.removeColumn("Whatsapps", "gupshupAppName")
    ]);
  }
};

