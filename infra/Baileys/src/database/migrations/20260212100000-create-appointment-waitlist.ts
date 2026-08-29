import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface
      .createTable("AppointmentWaitlists", {
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
        appointmentServiceId: {
          type: DataTypes.INTEGER,
          references: { model: "AppointmentServices", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE",
          allowNull: false,
        },
        assignedUserId: {
          type: DataTypes.INTEGER,
          references: { model: "Users", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE",
          allowNull: false,
        },
        preferredDate: {
          type: DataTypes.DATEONLY,
          allowNull: false,
        },
        responderName: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        responderPhone: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        responderEmail: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        notifiedAt: {
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
      })
      .then(() =>
        Promise.all([
          queryInterface.addIndex("AppointmentWaitlists", ["companyId"], {
            name: "idx_appointment_waitlists_company_id",
          }),
          queryInterface.addIndex("AppointmentWaitlists", ["formId"], {
            name: "idx_appointment_waitlists_form_id",
          }),
          queryInterface.addIndex("AppointmentWaitlists", ["notifiedAt"], {
            name: "idx_appointment_waitlists_notified_at",
          }),
        ])
      );
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.dropTable("AppointmentWaitlists");
  },
};
