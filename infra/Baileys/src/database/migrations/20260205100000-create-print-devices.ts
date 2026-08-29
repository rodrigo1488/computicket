import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface.createTable("PrintDevices", {
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
      deviceId: {
        type: DataTypes.STRING(64),
        allowNull: false
      },
      token: {
        type: DataTypes.STRING(255),
        allowNull: false
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: true
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
      return queryInterface.addIndex("PrintDevices", ["companyId", "deviceId"], {
        unique: true,
        name: "print_devices_company_device_unique"
      });
    }).then(() => {
      return queryInterface.addIndex("PrintDevices", ["token"], {
        name: "print_devices_token_idx"
      });
    });
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.dropTable("PrintDevices");
  }
};
