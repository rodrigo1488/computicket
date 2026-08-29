import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
    up: (queryInterface: QueryInterface) => {
        return queryInterface.createTable("UserAppointments", {
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
                allowNull: false,
            },
            title: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            description: {
                type: DataTypes.TEXT,
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
            userId: {
                type: DataTypes.INTEGER,
                references: { model: "Users", key: "id" },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
                allowNull: false,
            },
            assignedUserId: {
                type: DataTypes.INTEGER,
                references: { model: "Users", key: "id" },
                onUpdate: "CASCADE",
                onDelete: "SET NULL",
                allowNull: true,
            },
            companyId: {
                type: DataTypes.INTEGER,
                references: { model: "Companies", key: "id" },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
                allowNull: false,
            },
            status: {
                type: DataTypes.ENUM("pending", "confirmed", "cancelled", "completed"),
                allowNull: false,
                defaultValue: "pending",
            },
            reminderMinutes: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 15,
            },
            notificationSent: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            createdAt: {
                type: DataTypes.DATE,
                allowNull: false,
            },
            updatedAt: {
                type: DataTypes.DATE,
                allowNull: false,
            },
        }).then(() => {
            // Add indexes for performance
            return Promise.all([
                queryInterface.addIndex("UserAppointments", ["userId"], {
                    name: "idx_user_appointments_user_id",
                }),
                queryInterface.addIndex("UserAppointments", ["assignedUserId"], {
                    name: "idx_user_appointments_assigned_user_id",
                }),
                queryInterface.addIndex("UserAppointments", ["startTime"], {
                    name: "idx_user_appointments_start_time",
                }),
                queryInterface.addIndex("UserAppointments", ["companyId"], {
                    name: "idx_user_appointments_company_id",
                }),
                queryInterface.addIndex("UserAppointments", ["status"], {
                    name: "idx_user_appointments_status",
                }),
            ]);
        });
    },

    down: (queryInterface: QueryInterface) => {
        return queryInterface.dropTable("UserAppointments");
    },
};
