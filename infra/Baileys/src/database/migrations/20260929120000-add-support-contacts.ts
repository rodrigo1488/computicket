import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("SupportFolders", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false
      },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false
      }
    });

    await queryInterface.addIndex("SupportFolders", ["companyId", "name"], {
      unique: true,
      name: "SupportFolders_company_name_unique"
    });

    await queryInterface.addColumn("Contacts", "isSupport", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });

    await queryInterface.addColumn("Contacts", "supportFolderId", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "SupportFolders", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL"
    });

    await queryInterface.addColumn("Contacts", "supportWhatsappId", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Whatsapps", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL"
    });

    await queryInterface.addColumn("Tickets", "isSupport", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Tickets", "isSupport");
    await queryInterface.removeColumn("Contacts", "supportWhatsappId");
    await queryInterface.removeColumn("Contacts", "supportFolderId");
    await queryInterface.removeColumn("Contacts", "isSupport");
    await queryInterface.removeIndex(
      "SupportFolders",
      "SupportFolders_company_name_unique"
    );
    await queryInterface.dropTable("SupportFolders");
  }
};
