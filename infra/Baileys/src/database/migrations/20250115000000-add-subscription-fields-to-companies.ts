import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.addColumn("Companies", "preapprovalId", {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
      }),
      queryInterface.addColumn("Companies", "cardTokenId", {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
      }),
      queryInterface.addColumn("Companies", "autoRenew", {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      }),
      queryInterface.addColumn("Companies", "lastRenewalAttempt", {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      }),
      queryInterface.addColumn("Companies", "renewalAttempts", {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      }),
    ]);
  },

  down: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.removeColumn("Companies", "preapprovalId"),
      queryInterface.removeColumn("Companies", "cardTokenId"),
      queryInterface.removeColumn("Companies", "autoRenew"),
      queryInterface.removeColumn("Companies", "lastRenewalAttempt"),
      queryInterface.removeColumn("Companies", "renewalAttempts"),
    ]);
  }
};
