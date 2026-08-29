import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface
      .createTable("ProductVariations", {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        productId: {
          type: DataTypes.INTEGER,
          references: { model: "Products", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE",
          allowNull: false,
        },
        name: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        createdAt: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        updatedAt: {
          type: DataTypes.DATE,
          allowNull: false,
        },
      })
      .then(() =>
        queryInterface.createTable("ProductVariationOptions", {
          id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
            allowNull: false,
          },
          productVariationId: {
            type: DataTypes.INTEGER,
            references: { model: "ProductVariations", key: "id" },
            onUpdate: "CASCADE",
            onDelete: "CASCADE",
            allowNull: false,
          },
          label: {
            type: DataTypes.STRING,
            allowNull: false,
          },
          value: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
          },
          createdAt: {
            type: DataTypes.DATE,
            allowNull: false,
          },
          updatedAt: {
            type: DataTypes.DATE,
            allowNull: false,
          },
        })
      );
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface
      .dropTable("ProductVariationOptions")
      .then(() => queryInterface.dropTable("ProductVariations"));
  },
};
