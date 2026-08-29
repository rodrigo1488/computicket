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
} from "sequelize-typescript";

@Table({ tableName: "Modules" })
class Module extends Model<Module> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column
  name: string;

  @Column
  slug: string;

  @Column(DataType.TEXT)
  description: string;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: true,
  })
  price: number;

  @Default(true)
  @Column
  isActive: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default Module;
