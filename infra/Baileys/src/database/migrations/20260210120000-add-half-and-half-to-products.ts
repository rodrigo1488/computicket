import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.addColumn("Products", "allowsHalfAndHalf", {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      }),
      queryInterface.addColumn("Products", "halfAndHalfPriceRule", {
        type: DataTypes.STRING,
        allowNull: true,
      }),
      queryInterface.addColumn("Products", "halfAndHalfGrupo", {
        type: DataTypes.STRING,
        allowNull: true,
      }),
    ]);
  },

  down: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.removeColumn("Products", "allowsHalfAndHalf"),
      queryInterface.removeColumn("Products", "halfAndHalfPriceRule"),
      queryInterface.removeColumn("Products", "halfAndHalfGrupo"),
    ]);
  },
};
