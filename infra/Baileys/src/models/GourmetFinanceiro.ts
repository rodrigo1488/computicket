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

@Table({ tableName: "GourmetFinanceiro" })
class GourmetFinanceiro extends Model<GourmetFinanceiro> {
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
  tipo: string;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
  })
  valor: number;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: true,
  })
  subtotal: number;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
  })
  desconto: number;

  @Column
  descontoTipo: string;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: true,
  })
  descontoValor: number;

  @Column
  dataVenda: string;

  @Column
  mesaId: number;

  @Column
  mesaNumero: string;

  @Column
  formResponseId: number;

  @Column
  protocol: string;

  @Column
  entregadorUserId: number;

  @Column
  entregadorNome: string;

  @Column(DataType.JSON)
  meiosPagamento: any;

  @Column(DataType.JSON)
  itens: any;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default GourmetFinanceiro;
