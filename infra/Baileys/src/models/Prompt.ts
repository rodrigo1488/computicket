import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  CreatedAt,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
  DataType
} from "sequelize-typescript";
import Queue from "./Queue";
import Company from "./Company";

@Table
class Prompt extends Model<Prompt> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @AllowNull(false)
  @Column
  name: string;

  @AllowNull(false)
  @Column
  prompt: string;

  @AllowNull(false)
  @Column
  apiKey: string;

  @Column({ defaultValue: 10 })
  maxMessages: number;

  @Column({ defaultValue: 100 })
  maxTokens: number;

  @Column({ defaultValue: 1 })
  temperature: number;

  @Column({ defaultValue: 0 })
  promptTokens: number;

  @Column({ defaultValue: 0 })
  completionTokens: number;

  @Column({ defaultValue: 0 })
  totalTokens: number;

  @Column
  model: string;

  @Column({ defaultValue: "openai" })
  provider: string;

  @Column({ defaultValue: false })
  canSendInternalMessages: boolean;

  @Column({ defaultValue: false })
  canTransferToAgent: boolean;

  @Column({ defaultValue: false })
  canChangeTag: boolean;

  @Column({ defaultValue: false })
  permitirCriarAgendamentos: boolean;

  @Column({ defaultValue: null })
  tipoAgente: string;

  @Column({ defaultValue: false })
  isTemplate: boolean;

  @Column(DataType.TEXT)
  templateVariables: string;

  @Column(DataType.JSON)
  businessHours: any;

  @AllowNull
  @ForeignKey(() => Queue)
  @Column
  transferQueueId: number;

  @BelongsTo(() => Queue, "transferQueueId")
  transferQueue: Queue;

  @AllowNull
  @ForeignKey(() => Queue)
  @Column
  queueId: number;

  @BelongsTo(() => Queue)
  queue: Queue;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default Prompt;
