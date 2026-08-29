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
import ProductVariation from "./ProductVariation";

@Table
class ProductVariationOption extends Model<ProductVariationOption> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => ProductVariation)
  @Column
  productVariationId: number;

  @BelongsTo(() => ProductVariation)
  productVariation: ProductVariation;

  @Column
  label: string;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
  })
  value: number;

  /** Código do produto no UniPlus (ex.: tamanho G) — único por company no service */
  @Column({
    type: DataType.STRING(20),
    allowNull: true,
  })
  idUniplus: string | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default ProductVariationOption;
