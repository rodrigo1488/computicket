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
  ForeignKey,
  BelongsTo,
} from "sequelize-typescript";
import Company from "./Company";
import User from "./User";

@Table({ tableName: "AppointmentServices" })
class AppointmentService extends Model<AppointmentService> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @ForeignKey(() => User)
  @Column
  userId: number;

  @BelongsTo(() => User)
  user: User;

  @Column
  name: string;

  @Column
  durationMinutes: number;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: true,
  })
  value: number;

  @Column(DataType.TEXT)
  description: string;

  @Default(true)
  @Column
  isActive: boolean;

  @Default(0)
  @Column
  displayOrder: number;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AppointmentService;
