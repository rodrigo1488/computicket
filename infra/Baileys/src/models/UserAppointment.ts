import {
    Table,
    Column,
    CreatedAt,
    UpdatedAt,
    Model,
    PrimaryKey,
    AutoIncrement,
    AllowNull,
    Default,
    ForeignKey,
    BelongsTo,
    DataType,
} from "sequelize-typescript";
import Company from "./Company";
import User from "./User";
import Task from "./Task";

@Table({ tableName: "UserAppointments" })
class UserAppointment extends Model<UserAppointment> {
    @PrimaryKey
    @AutoIncrement
    @Column
    id: number;

    @AllowNull(false)
    @Column
    title: string;

    @AllowNull(true)
    @Column(DataType.TEXT)
    description: string;

    @AllowNull(false)
    @Column
    startTime: Date;

    @AllowNull(false)
    @Column
    endTime: Date;

    @ForeignKey(() => User)
    @AllowNull(false)
    @Column
    userId: number;

    @BelongsTo(() => User, "userId")
    user: User;

    @ForeignKey(() => User)
    @AllowNull(true)
    @Column
    assignedUserId: number;

    @BelongsTo(() => User, "assignedUserId")
    assignedUser: User;

    @ForeignKey(() => Company)
    @AllowNull(false)
    @Column
    companyId: number;

    @BelongsTo(() => Company)
    company: Company;

    @AllowNull(false)
    @Default("pending")
    @Column(DataType.ENUM("pending", "confirmed", "cancelled", "completed"))
    status: string;

    @AllowNull(false)
    @Default(15)
    @Column
    reminderMinutes: number;

    @AllowNull(false)
    @Default(false)
    @Column
    notificationSent: boolean;

    @ForeignKey(() => Task)
    @AllowNull(true)
    @Column
    taskId: number;

    @BelongsTo(() => Task, "taskId")
    task: Task;

    @CreatedAt
    createdAt: Date;

    @UpdatedAt
    updatedAt: Date;
}

export default UserAppointment;
