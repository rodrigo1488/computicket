import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface.createTable("Forms", {
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
      description: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      slug: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      primaryColor: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: "#667eea"
      },
      secondaryColor: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: "#764ba2"
      },
      logoPosition: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: "top"
      },
      logoUrl: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      successMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: "Obrigado! Seu formulário foi enviado com sucesso."
      },
      successRedirectUrl: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      requireAuth: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      allowMultipleSubmissions: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      createContact: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      createTicket: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      sendWebhook: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      webhookUrl: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      settings: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      createdBy: {
        type: DataTypes.INTEGER,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
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
    });
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.dropTable("Forms");
  }
};
