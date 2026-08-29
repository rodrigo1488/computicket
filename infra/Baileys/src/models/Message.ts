import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  Default,
  BelongsTo,
  ForeignKey
} from "sequelize-typescript";
import Contact from "./Contact";
import Ticket from "./Ticket";
import Company from "./Company";
import Queue from "./Queue";

@Table({
  indexes: [
    // Índice composto para queries frequentes de mensagens por ticket
    { fields: ["ticketId", "createdAt", "id"] },
    // Índice composto para queries por empresa e ticket
    { fields: ["companyId", "ticketId", "createdAt"] },
    // Índice para quotedMsgId (usado em joins)
    { fields: ["quotedMsgId"] },
    // Índice para contactId
    { fields: ["contactId"] }
  ]
})
class Message extends Model<Message> {
  @PrimaryKey
  @Column
  id: string;

  @Column(DataType.STRING)
  remoteJid: string;

  @Column(DataType.STRING)
  participant: string;

  @Column(DataType.STRING)
  dataJson: string;

  @Default(0)
  @Column
  ack: number;

  @Default(false)
  @Column
  read: boolean;

  @Default(false)
  @Column
  fromMe: boolean;

  @Column(DataType.TEXT)
  body: string;

  @Column(DataType.STRING)
  get mediaUrl(): string | null {
    if (this.getDataValue("mediaUrl")) {
      return `${process.env.BACKEND_URL}/public/${this.getDataValue(
        "mediaUrl"
      )}`;
    }
    return null;
  }

  @Column
  mediaType: string;

  @Default(false)
  @Column
  isDeleted: boolean;

  @CreatedAt
  @Column(DataType.DATE(6))
  createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(6))
  updatedAt: Date;

  @ForeignKey(() => Message)
  @Column
  quotedMsgId: string;

  @BelongsTo(() => Message, "quotedMsgId")
  quotedMsg: Message;

  @ForeignKey(() => Ticket)
  @Column
  ticketId: number;

  @BelongsTo(() => Ticket)
  ticket: Ticket;

  @ForeignKey(() => Contact)
  @Column
  contactId: number;

  @BelongsTo(() => Contact, "contactId")
  contact: Contact;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @ForeignKey(() => Queue)
  @Column
  queueId: number;

  @BelongsTo(() => Queue)
  queue: Queue;
  
  @Default(false)
  @Column
  isEdited: boolean;

  @Default(false)
  @Column
  isForwarded: boolean;

  @Default(false)
  @Column
  isInternal: boolean;

  @Column(DataType.TEXT)
  transcription?: string | null;

  @Column(DataType.STRING)
  transcriptionStatus?: string | null;

  @Column(DataType.STRING(512))
  transcriptionError?: string | null;
}

export default Message;
