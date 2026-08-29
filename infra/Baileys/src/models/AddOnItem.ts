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
import AddOnGroup from "./AddOnGroup";
import AddOnSubgroup from "./AddOnSubgroup";

@Table
class AddOnItem extends Model<AddOnItem> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => AddOnGroup)
  @Column
  addOnGroupId: number;

  @BelongsTo(() => AddOnGroup)
  addOnGroup: AddOnGroup;

  @ForeignKey(() => AddOnSubgroup)
  @Column
  addOnSubgroupId: number | null;

  @BelongsTo(() => AddOnSubgroup)
  addOnSubgroup: AddOnSubgroup | null;

  @Column
  label: string;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
  })
  value: number;

  @Column({
    type: DataType.INTEGER,
    defaultValue: 0,
  })
  order: number;

  /** Código do produto no UniPlus (adicional vinculado) — único por company no service */
  @Column({
    type: DataType.STRING(20),
    allowNull: true,
  })
  idUniplus: string | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AddOnItem;
