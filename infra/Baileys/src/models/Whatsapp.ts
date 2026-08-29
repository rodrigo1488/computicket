import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  Default,
  AllowNull,
  HasMany,
  BelongsToMany,
  ForeignKey,
  BelongsTo
} from "sequelize-typescript";
import Queue from "./Queue";
import Ticket from "./Ticket";
import WhatsappQueue from "./WhatsappQueue";
import Company from "./Company";
import Prompt from "./Prompt";
import QueueIntegrations from "./QueueIntegrations";
import { FlowBuilderModel } from "./FlowBuilder";

@Table({
  indexes: [
    { unique: true, name: "Whatsapps_companyId_name_unique", fields: ["companyId", "name"] }
  ]
})
class Whatsapp extends Model<Whatsapp> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @AllowNull
  @Column(DataType.TEXT)
  name: string;

  @Column(DataType.TEXT)
  session: string;

  @Column(DataType.TEXT)
  qrcode: string;

  @Column
  status: string;

  @Column
  battery: string;

  @Column
  plugged: boolean;

  @Column
  retries: number;

  @Default("")
  @Column(DataType.TEXT)
  greetingMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  farewellMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  complationMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  outOfHoursMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  ratingMessage: string;

  @Column({ defaultValue: "stable" })
  provider: string;

  @Default(false)
  @AllowNull
  @Column
  isDefault: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @HasMany(() => Ticket)
  tickets: Ticket[];

  @BelongsToMany(() => Queue, () => WhatsappQueue)
  queues: Array<Queue & { WhatsappQueue: WhatsappQueue }>;

  @HasMany(() => WhatsappQueue)
  whatsappQueues: WhatsappQueue[];

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @Column
  token: string;

  //@Default(0)
  //@Column
  //timeSendQueue: number;

  //@Column
  //sendIdQueue: number;

  @Column
  transferQueueId: number;

  @Column
  timeToTransfer: number;

  @ForeignKey(() => Prompt)
  @Column
  promptId: number;

  @BelongsTo(() => Prompt)
  prompt: Prompt;

  @ForeignKey(() => QueueIntegrations)
  @Column
  integrationId: number;

  @BelongsTo(() => QueueIntegrations)
  queueIntegrations: QueueIntegrations;

  @Column
  maxUseBotQueues: number;

  @Column
  timeUseBotQueues: string;

  @Column
  expiresTicket: number;

  @Column
  expiresInactiveMessage: string;

  @ForeignKey(() => FlowBuilderModel)
  @Column
  flowIdNotPhrase: number;

  @ForeignKey(() => FlowBuilderModel)
  @Column
  flowIdWelcome: number;

  @BelongsTo(() => FlowBuilderModel)
  flowBuilder: FlowBuilderModel

  @Column
  gupshupApiKey: string;

  @AllowNull
  @Column
  gupshupAppName: string;

  @Default('whatsapp')
  @Column
  type: string;

  @AllowNull
  @Column
  fbPageId: string;

  @AllowNull
  @Column(DataType.TEXT)
  facebookUserToken: string;

  @AllowNull
  @Column(DataType.TEXT)
  tokenStore: string;
}

export default Whatsapp;
