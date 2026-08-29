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
import AddOnGroup from "./AddOnGroup";

@Table({
  indexes: [
    {
      unique: true,
      fields: ["companyId", "grupo"],
    },
  ],
})
class GrupoAddOn extends Model<GrupoAddOn> {
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
  grupo: string;

  @ForeignKey(() => AddOnGroup)
  @Column
  addOnGroupId: number;

  @BelongsTo(() => AddOnGroup)
  addOnGroup: AddOnGroup;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default GrupoAddOn;
