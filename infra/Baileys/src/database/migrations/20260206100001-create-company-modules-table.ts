import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface.createTable("CompanyModules", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      moduleId: {
        type: DataTypes.INTEGER,
        references: { model: "Modules", key: "id" },
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
    }).then(() => {
      return queryInterface.addConstraint("CompanyModules", ["companyId", "moduleId"], {
        type: "unique",
        name: "company_modules_unique"
      });
    });
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.dropTable("CompanyModules");
  }
};
