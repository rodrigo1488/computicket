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
} from "sequelize-typescript";
import Company from "./Company";
import Mesa from "./Mesa";
import Contact from "./Contact";
import Ticket from "./Ticket";

@Table
class MesaOccupationConfirmation extends Model<MesaOccupationConfirmation> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Mesa)
  @Column
  mesaId: number;

  @BelongsTo(() => Mesa)
  mesa: Mesa;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @ForeignKey(() => Contact)
  @Column
  contactId: number;

  @BelongsTo(() => Contact)
  contact: Contact;

  @ForeignKey(() => Ticket)
  @Column(DataType.INTEGER)
  ticketId: number | null;

  @BelongsTo(() => Ticket)
  ticket: Ticket;

  @Column
  keyword: string;

  @Default("pending")
  @Column
  status: string;

  @Default(0)
  @Column
  attempts: number;

  @Default(false)
  @Column
  transferir: boolean;

  @Column(DataType.DATE)
  expiresAt: Date;

  @Column(DataType.DATE)
  confirmedAt: Date | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default MesaOccupationConfirmation;
