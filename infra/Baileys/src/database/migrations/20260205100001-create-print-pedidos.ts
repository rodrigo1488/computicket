import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface.createTable("PrintPedidos", {
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
      formId: {
        type: DataTypes.INTEGER,
        references: { model: "Forms", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        allowNull: true
      },
      formResponseId: {
        type: DataTypes.INTEGER,
        references: { model: "FormResponses", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        allowNull: true
      },
      conteudo: {
        type: DataTypes.JSON,
        allowNull: true
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "pending"
      },
      tentativas: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      maxTentativas: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 3
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      printedAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      errorMessage: {
        type: DataTypes.TEXT,
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
      return queryInterface.addIndex("PrintPedidos", ["companyId", "deviceId", "status"], {
        name: "print_pedidos_company_device_status_idx"
      });
    }).then(() => {
      return queryInterface.addIndex("PrintPedidos", ["status", "expiresAt"], {
        name: "print_pedidos_status_expires_idx"
      });
    });
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.dropTable("PrintPedidos");
  }
};
