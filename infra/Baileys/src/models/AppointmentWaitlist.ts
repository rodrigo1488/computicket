import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  ForeignKey,
  BelongsTo,
} from "sequelize-typescript";
import Company from "./Company";
import Form from "./Form";
import AppointmentService from "./AppointmentService";
import User from "./User";

@Table({ tableName: "AppointmentWaitlists" })
class AppointmentWaitlist extends Model<AppointmentWaitlist> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @ForeignKey(() => Form)
  @Column
  formId: number;

  @BelongsTo(() => Form)
  form: Form;

  @ForeignKey(() => AppointmentService)
  @Column
  appointmentServiceId: number;

  @BelongsTo(() => AppointmentService)
  appointmentService: AppointmentService;

  @ForeignKey(() => User)
  @Column
  assignedUserId: number;

  @BelongsTo(() => User, "assignedUserId")
  assignedUser: User;

  @Column(DataType.DATEONLY)
  preferredDate: string;

  @AllowNull(true)
  @Column
  responderName: string;

  @Column
  responderPhone: string;

  @AllowNull(true)
  @Column
  responderEmail: string;

  @AllowNull(true)
  @Column
  notifiedAt: Date;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AppointmentWaitlist;
