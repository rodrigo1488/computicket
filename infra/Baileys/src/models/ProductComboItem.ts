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
  Default,
  AllowNull,
} from "sequelize-typescript";
import Product from "./Product";
import ProductVariationOption from "./ProductVariationOption";

@Table
class ProductComboItem extends Model<ProductComboItem> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Product)
  @Column
  comboProductId: number;

  @BelongsTo(() => Product, { foreignKey: "comboProductId", as: "comboProduct" })
  comboProduct: Product;

  @ForeignKey(() => Product)
  @Column
  productId: number;

  @BelongsTo(() => Product, { foreignKey: "productId", as: "product" })
  product: Product;

  @ForeignKey(() => ProductVariationOption)
  @AllowNull(true)
  @Column
  variationOptionId: number | null;

  @BelongsTo(() => ProductVariationOption, {
    foreignKey: "variationOptionId",
    as: "variationOption",
  })
  variationOption: ProductVariationOption | null;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
  })
  value: number;

  @Default(1)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  quantity: number;

  @Default(0)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  order: number;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default ProductComboItem;
