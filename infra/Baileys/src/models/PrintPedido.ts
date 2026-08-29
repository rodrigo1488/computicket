import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  ForeignKey,
  BelongsTo,
  Default,
  DataType
} from "sequelize-typescript";
import Company from "./Company";
import Form from "./Form";
import FormResponse from "./FormResponse";

@Table({
  tableName: "PrintPedidos",
  indexes: [
    { fields: ["companyId", "deviceId", "status"] },
    { fields: ["status", "expiresAt"] }
  ]
})
class PrintPedido extends Model<PrintPedido> {
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
  deviceId: string;

  @ForeignKey(() => Form)
  @Column
  formId: number;

  @BelongsTo(() => Form)
  form: Form;

  @ForeignKey(() => FormResponse)
  @Column
  formResponseId: number;

  @BelongsTo(() => FormResponse)
  formResponse: FormResponse;

  @Column(DataType.JSON)
  conteudo: object;

  @Default("print")
  @Column
  tipo: string;

  @Column
  uniplusContaId: number | null;

  @Column(DataType.STRING(40))
  externalRef: string | null;

  @Default("pending")
  @Column
  status: string;

  @Default(0)
  @Column
  tentativas: number;

  @Default(3)
  @Column
  maxTentativas: number;

  @Column
  expiresAt: Date;

  @Column
  printedAt: Date;

  @Column(DataType.TEXT)
  errorMessage: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default PrintPedido;
