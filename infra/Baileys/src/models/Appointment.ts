import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  Default,
  AllowNull,
  ForeignKey,
  BelongsTo,
} from "sequelize-typescript";
import Company from "./Company";
import Form from "./Form";
import FormResponse from "./FormResponse";
import Contact from "./Contact";
import AppointmentService from "./AppointmentService";
import User from "./User";

@Table({ tableName: "Appointments" })
class Appointment extends Model<Appointment> {
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

  @AllowNull(true)
  @ForeignKey(() => FormResponse)
  @Column
  formResponseId: number;

  @BelongsTo(() => FormResponse)
  formResponse: FormResponse;

  @AllowNull(true)
  @ForeignKey(() => Contact)
  @Column
  contactId: number;

  @BelongsTo(() => Contact)
  contact: Contact;

  @AllowNull(true)
  @ForeignKey(() => AppointmentService)
  @Column
  appointmentServiceId: number;

  @BelongsTo(() => AppointmentService)
  appointmentService: AppointmentService;

  @AllowNull(true)
  @ForeignKey(() => User)
  @Column
  assignedUserId: number;

  @BelongsTo(() => User, "assignedUserId")
  assignedUser: User;

  @Column
  startTime: Date;

  @Column
  endTime: Date;

  @Default("pending")
  @Column(DataType.ENUM("pending", "confirmed", "cancelled", "completed"))
  status: string;

  @Column
  responderName: string;

  @Column
  responderPhone: string;

  @Column(DataType.JSONB)
  metadata: object;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default Appointment;
