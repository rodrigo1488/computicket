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
import Company from "./Company";
import User from "./User";
import FormField from "./FormField";
import FormResponse from "./FormResponse";

@Table
class Form extends Model<Form> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column
  name: string;

  @Column(DataType.TEXT)
  description: string;

  @Column
  slug: string; // URL-friendly unique identifier

  @Column
  publicId: string; // Public unguessable identifier (used in public URLs)

  @Default(true)
  @Column
  isActive: boolean;

  @Default("#667eea")
  @Column
  primaryColor: string;

  @Default("#764ba2")
  @Column
  secondaryColor: string;

  @Default("top")
  @Column
  logoPosition: string; // top, center, none

  @Column(DataType.TEXT)
  logoUrl: string;

  @Default("Obrigado! Seu formulário foi enviado com sucesso.")
  @Column(DataType.TEXT)
  successMessage: string;

  @Column(DataType.TEXT)
  successRedirectUrl: string;

  @Default(false)
  @Column
  requireAuth: boolean;

  @Default(false)
  @Column
  allowMultipleSubmissions: boolean;

  @Default(false)
  @Column
  isAnonymous: boolean;

  // Actions after submission
  @Default(true)
  @Column
  createContact: boolean;

  @Default(false)
  @Column
  createTicket: boolean;

  @Default(false)
  @Column
  sendWebhook: boolean;

  @Column(DataType.TEXT)
  webhookUrl: string;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @ForeignKey(() => User)
  @Column
  createdBy: number;

  @BelongsTo(() => User)
  creator: User;

  @HasMany(() => FormField, {
    onUpdate: "CASCADE",
    onDelete: "CASCADE",
    hooks: true,
  })
  fields: FormField[];

  @HasMany(() => FormResponse, {
    onUpdate: "CASCADE",
    onDelete: "CASCADE",
    hooks: true,
  })
  responses: FormResponse[];

  @Column(DataType.JSONB)
  settings: object; // Advanced settings

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default Form;
