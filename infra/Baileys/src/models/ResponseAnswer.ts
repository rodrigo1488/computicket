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
import FormResponse from "./FormResponse";
import FormField from "./FormField";

@Table
class ResponseAnswer extends Model<ResponseAnswer> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => FormResponse)
  @Column
  responseId: number;

  @BelongsTo(() => FormResponse)
  response: FormResponse;

  @ForeignKey(() => FormField)
  @Column
  fieldId: number;

  @BelongsTo(() => FormField)
  field: FormField;

  @Column(DataType.TEXT)
  answer: string; // String representation of answer

  @Column(DataType.JSONB)
  answerData: object; // For complex answers (arrays, objects)

  @Column(DataType.TEXT)
  fileUrl: string; // If file upload

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default ResponseAnswer;
