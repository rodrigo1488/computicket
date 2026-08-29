import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface
      .createTable("Appointments", {
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
        formId: {
          type: DataTypes.INTEGER,
          references: { model: "Forms", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE",
          allowNull: false,
        },
        formResponseId: {
          type: DataTypes.INTEGER,
          references: { model: "FormResponses", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "SET NULL",
          allowNull: true,
        },
        contactId: {
          type: DataTypes.INTEGER,
          references: { model: "Contacts", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "SET NULL",
          allowNull: true,
        },
        appointmentServiceId: {
          type: DataTypes.INTEGER,
          references: { model: "AppointmentServices", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "SET NULL",
          allowNull: true,
        },
        assignedUserId: {
          type: DataTypes.INTEGER,
          references: { model: "Users", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "SET NULL",
          allowNull: true,
        },
        startTime: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        endTime: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        status: {
          type: DataTypes.ENUM("pending", "confirmed", "cancelled", "completed"),
          allowNull: false,
          defaultValue: "pending",
        },
        responderName: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        responderPhone: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        metadata: {
          type: DataTypes.JSONB,
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
      })
      .then(() =>
        Promise.all([
          queryInterface.addIndex("Appointments", ["companyId"], {
            name: "idx_appointments_company_id",
          }),
          queryInterface.addIndex("Appointments", ["formId"], {
            name: "idx_appointments_form_id",
          }),
          queryInterface.addIndex("Appointments", ["assignedUserId"], {
            name: "idx_appointments_assigned_user_id",
          }),
          queryInterface.addIndex("Appointments", ["startTime"], {
            name: "idx_appointments_start_time",
          }),
          queryInterface.addIndex("Appointments", ["status"], {
            name: "idx_appointments_status",
          }),
        ])
      );
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.dropTable("Appointments");
  },
};
