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

@Table({ tableName: "GourmetDespesa" })
class GourmetDespesa extends Model<GourmetDespesa> {
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
  descricao: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  fornecedor: string | null;

  @Column(DataType.TEXT)
  observacoes: string;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
  })
  valor: number;

  @Column
  dataVencimento: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default GourmetDespesa;
