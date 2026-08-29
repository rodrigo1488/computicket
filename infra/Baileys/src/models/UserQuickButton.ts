import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  ForeignKey,
  BelongsTo,
  AutoIncrement,
  Default,
  AllowNull,
  DataType,
} from "sequelize-typescript";

import Company from "./Company";
import User from "./User";

@Table({ tableName: "UserQuickButtons" })
class UserQuickButton extends Model<UserQuickButton> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column
  userId: number;

  @BelongsTo(() => User)
  user: User;

  @AllowNull(false)
  @Column
  label: string;

  @AllowNull(false)
  @Column
  route: string;

  @AllowNull(true)
  @Column
  icon: string;

  @AllowNull(true)
  @Default("#1976d2")
  @Column
  color: string;

  @AllowNull(false)
  @Default(0)
  @Column
  order: number;

  @AllowNull(false)
  @Default(true)
  @Column(DataType.BOOLEAN)
  isVisible: boolean;

  @ForeignKey(() => Company)
  @AllowNull(false)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default UserQuickButton;
