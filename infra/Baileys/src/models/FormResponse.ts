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
  ForeignKey,
  BelongsTo,
  HasMany,
} from "sequelize-typescript";
import Form from "./Form";
import Contact from "./Contact";
import Ticket from "./Ticket";
import ResponseAnswer from "./ResponseAnswer";

@Table
class FormResponse extends Model<FormResponse> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Form)
  @Column
  formId: number;

  @BelongsTo(() => Form)
  form: Form;

  @Column
  responderPhone: string; // Tracked phone number

  @Column
  responderEmail: string;

  @Column
  responderName: string;

  @Column
  ipAddress: string;

  @Column(DataType.TEXT)
  userAgent: string;

  @ForeignKey(() => Contact)
  @Column
  contactId: number; // Created/linked contact

  @BelongsTo(() => Contact)
  contact: Contact;

  @ForeignKey(() => Ticket)
  @Column
  ticketId: number; // Created ticket (if configured)

  @BelongsTo(() => Ticket)
  ticket: Ticket;

  @Default(false)
  @Column
  isRead: boolean; // Marked as read by user

  @Default(false)
  @Column
  isStarred: boolean;

  @Column(DataType.JSONB)
  metadata: object; // UTM params, referrer, etc.

  @Column
  orderStatus: string; // novo, confirmado, em_preparo, pronto, saiu_entrega, entregue, cancelado (só para formType=cardapio)

  @Column
  protocol: string; // PED-YYYYMMDD-NNNN para identificação única do pedido

  @Column
  mesaSessionId: string; // Sessão da mesa ao qual o pedido pertence (para conta ao liberar)

  @HasMany(() => ResponseAnswer, {
    onUpdate: "CASCADE",
    onDelete: "CASCADE",
    hooks: true,
  })
  answers: ResponseAnswer[];

  @CreatedAt
  submittedAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default FormResponse;
