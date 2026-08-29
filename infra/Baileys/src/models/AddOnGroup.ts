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
import Company from "./Company";
import AddOnSubgroup from "./AddOnSubgroup";
import AddOnItem from "./AddOnItem";

@Table
class AddOnGroup extends Model<AddOnGroup> {
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
  name: string;

  /** Regras aplicadas aos itens sem subgrupo (raiz do grupo) */
  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  required: boolean;

  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  minItems: number;

  @Column({ type: DataType.INTEGER, allowNull: true })
  maxItems: number | null;

  @HasMany(() => AddOnSubgroup)
  subgroups: AddOnSubgroup[];

  @HasMany(() => AddOnItem)
  items: AddOnItem[];

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AddOnGroup;
