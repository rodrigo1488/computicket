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
  HasMany,
} from "sequelize-typescript";
import AddOnGroup from "./AddOnGroup";
import AddOnItem from "./AddOnItem";

@Table
class AddOnSubgroup extends Model<AddOnSubgroup> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => AddOnGroup)
  @Column
  addOnGroupId: number;

  @BelongsTo(() => AddOnGroup)
  addOnGroup: AddOnGroup;

  @Column
  name: string;

  @Column({
    type: DataType.INTEGER,
    defaultValue: 0,
  })
  order: number;

  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  required: boolean;

  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  minItems: number;

  @Column({ type: DataType.INTEGER, allowNull: true })
  maxItems: number | null;

  @HasMany(() => AddOnItem)
  items: AddOnItem[];

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AddOnSubgroup;
