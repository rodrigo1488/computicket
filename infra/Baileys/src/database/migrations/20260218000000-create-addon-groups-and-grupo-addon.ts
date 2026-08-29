import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("AddOnGroups", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
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
    });

    await queryInterface.createTable("AddOnSubgroups", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      addOnGroupId: {
        type: DataTypes.INTEGER,
        references: { model: "AddOnGroups", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
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

    await queryInterface.createTable("AddOnItems", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      addOnGroupId: {
        type: DataTypes.INTEGER,
        references: { model: "AddOnGroups", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false,
      },
      addOnSubgroupId: {
        type: DataTypes.INTEGER,
        references: { model: "AddOnSubgroups", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: true,
      },
      label: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      value: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
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

    await queryInterface.createTable("GrupoAddOns", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false,
      },
      grupo: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      addOnGroupId: {
        type: DataTypes.INTEGER,
        references: { model: "AddOnGroups", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
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
    });

    await queryInterface.addIndex("GrupoAddOns", ["companyId", "grupo"], {
      unique: true,
      name: "grupo_add_ons_company_id_grupo_unique",
    });

    await queryInterface.addColumn(
      "Products",
      "addOnGroupId",
      {
        type: DataTypes.INTEGER,
        references: { model: "AddOnGroups", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        allowNull: true,
      }
    );
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Products", "addOnGroupId");
    await queryInterface.dropTable("GrupoAddOns");
    await queryInterface.dropTable("AddOnItems");
    await queryInterface.dropTable("AddOnSubgroups");
    await queryInterface.dropTable("AddOnGroups");
  },
};
