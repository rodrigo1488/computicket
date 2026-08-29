import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  DataType
} from "sequelize-typescript";

@Table({
  tableName: "HelpArticles"
})
class HelpArticle extends Model<HelpArticle> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column
  title: string;

  @Column(DataType.TEXT)
  content: string;

  @Column(DataType.TEXT)
  summary: string;

  @Column(DataType.TEXT)
  keywords: string;

  @Column
  category: string;

  @Column({ defaultValue: 0 })
  order: number;

  @Column({ defaultValue: true })
  isActive: boolean;

  @Column({ defaultValue: 1 })
  createdByCompanyId: number;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default HelpArticle;
