import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("MesaOccupationConfirmations", {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      mesaId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Mesas", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      contactId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Contacts", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Tickets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      keyword: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "pending",
      },
      attempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      transferir: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      confirmedAt: {
        type: DataTypes.DATE,
        allowNull: true,
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

    await queryInterface.addIndex("MesaOccupationConfirmations", ["mesaId", "status"], {
      name: "mesa_occ_conf_mesa_status_idx",
    });
    await queryInterface.addIndex("MesaOccupationConfirmations", ["companyId", "status"], {
      name: "mesa_occ_conf_company_status_idx",
    });
    await queryInterface.addIndex("MesaOccupationConfirmations", ["expiresAt"], {
      name: "mesa_occ_conf_expires_idx",
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex("MesaOccupationConfirmations", "mesa_occ_conf_mesa_status_idx");
    await queryInterface.removeIndex("MesaOccupationConfirmations", "mesa_occ_conf_company_status_idx");
    await queryInterface.removeIndex("MesaOccupationConfirmations", "mesa_occ_conf_expires_idx");
    await queryInterface.dropTable("MesaOccupationConfirmations");
  },
};
