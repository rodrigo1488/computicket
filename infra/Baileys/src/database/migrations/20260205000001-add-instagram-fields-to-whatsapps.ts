import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.addColumn("Whatsapps", "type", {
        type: DataTypes.STRING,
        defaultValue: 'whatsapp',
        allowNull: false
      }),
      queryInterface.addColumn("Whatsapps", "fbPageId", {
        type: DataTypes.STRING,
        allowNull: true
      }),
      queryInterface.addColumn("Whatsapps", "facebookUserToken", {
        type: DataTypes.TEXT,
        allowNull: true
      }),
      queryInterface.addColumn("Whatsapps", "tokenStore", {
        type: DataTypes.TEXT,
        allowNull: true
      })
    ]);
  },

  down: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.removeColumn("Whatsapps", "type"),
      queryInterface.removeColumn("Whatsapps", "fbPageId"),
      queryInterface.removeColumn("Whatsapps", "facebookUserToken"),
      queryInterface.removeColumn("Whatsapps", "tokenStore")
    ]);
  }
};
