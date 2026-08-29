import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  ForeignKey,
  BelongsTo
} from "sequelize-typescript";
import Tag from "./Tag";
import Ticket from "./Ticket";

@Table({
  tableName: 'TicketTags',
  indexes: [
    // Índice composto para queries frequentes de tags por ticket
    { fields: ["tagId", "ticketId"] },
    // Índice para ticketId (usado em filtros)
    { fields: ["ticketId"] },
    // Índice para tagId (usado em filtros)
    { fields: ["tagId"] }
  ]
})
class TicketTag extends Model<TicketTag> {
  @ForeignKey(() => Ticket)
  @Column
  ticketId: number;

  @ForeignKey(() => Tag)
  @Column
  tagId: number;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @BelongsTo(() => Ticket)
  ticket: Ticket;

  @BelongsTo(() => Tag)
  tag: Tag;
}

export default TicketTag;
