import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Products", "isCombo", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    await queryInterface.createTable("ProductComboItems", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      comboProductId: {
        type: DataTypes.INTEGER,
        references: { model: "Products", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false,
      },
      productId: {
        type: DataTypes.INTEGER,
        references: { model: "Products", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
        allowNull: false,
      },
      variationOptionId: {
        type: DataTypes.INTEGER,
        references: { model: "ProductVariationOptions", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        allowNull: true,
      },
      value: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex("ProductComboItems", ["comboProductId"], {
      name: "product_combo_items_combo_product_id",
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("ProductComboItems");
    await queryInterface.removeColumn("Products", "isCombo");
  },
};
