import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  ForeignKey,
  BelongsTo,
} from "sequelize-typescript";
import Company from "./Company";

@Table
class Coupon extends Model<Coupon> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @Column
  code: string;

  /** "percent" | "fixed" */
  @Column({ type: DataType.STRING, defaultValue: "percent" })
  discountType: string;

  @Column(DataType.DECIMAL(10, 2))
  discountValue: number;

  @Column({ type: DataType.DECIMAL(10, 2), allowNull: true })
  minOrderValue: number | null;

  @Column({ type: DataType.DATE, allowNull: true })
  expiresAt: Date | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  usageLimit: number | null;

  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  usageCount: number;

  @Column({ type: DataType.BOOLEAN, defaultValue: true })
  active: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default Coupon;
