import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  DataType,
} from "sequelize-typescript";

@Table
class CustomProposal extends Model<CustomProposal> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @AllowNull(false)
  @Column
  name: string;

  @AllowNull(false)
  @Column
  company: string;

  @AllowNull(false)
  @Column
  email: string;

  @AllowNull(false)
  @Column
  phone: string;

  @AllowNull(false)
  @Column
  users: number;

  @AllowNull(false)
  @Column
  collaborators: number;

  @Column(DataType.JSONB)
  features: string[];

  @Column(DataType.TEXT)
  message: string;

  @Column
  planId: number;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default CustomProposal;
