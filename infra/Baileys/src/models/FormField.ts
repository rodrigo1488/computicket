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
import Form from "./Form";

@Table
class FormField extends Model<FormField> {
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
  label: string;

  @Column
  fieldType: string; // text, textarea, email, phone, number, select, radio, checkbox, date, time, file, rating

  @Column(DataType.TEXT)
  placeholder: string;

  @Default(false)
  @Column
  isRequired: boolean;

  @Column
  order: number; // Field display order

  @Column(DataType.JSONB)
  options: string[]; // For select/radio/checkbox

  @Column(DataType.TEXT)
  helpText: string;

  @Column(DataType.JSONB)
  validation: object; // {min: 5, max: 100, regex: "..."}

  // Conditional Logic
  @Default(false)
  @Column
  hasConditional: boolean;

  @Column(DataType.JSONB)
  conditionalRules: object;
  /* Example:
  {
    "operator": "AND", // OR
    "conditions": [
      {"fieldId": 2, "operator": "equals", "value": "Sim"},
      {"fieldId": 3, "operator": "greaterThan", "value": 18}
    ]
  }
  */

  @Column
  conditionalFieldId: number; // Parent field ID

  @Column(DataType.JSONB)
  metadata: object; // Extra field-specific data

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default FormField;
