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
import ProductVariation from "./ProductVariation";
import ProductComboItem from "./ProductComboItem";
import AddOnGroup from "./AddOnGroup";

@Table
class Product extends Model<Product> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column
  name: string;

  @Column(DataType.TEXT)
  description: string;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
  })
  value: number;

  @Column({
    type: DataType.INTEGER,
    defaultValue: 0,
  })
  quantity: number;

  @Default(false)
  @Column
  isMenuProduct: boolean;

  @Default(false)
  @Column
  variablePrice: boolean;

  @Default(false)
  @Column
  isCombo: boolean;

  @Default(false)
  @Column
  allowsHalfAndHalf: boolean;

  @Column(DataType.STRING)
  halfAndHalfPriceRule: string | null;

  @Column(DataType.STRING)
  halfAndHalfGrupo: string | null;

  @Column
  grupo: string;

  @Column(DataType.STRING(20))
  idUniplus: string | null;

  @Column(DataType.TEXT)
  imageUrl: string;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @ForeignKey(() => AddOnGroup)
  @Column
  addOnGroupId: number | null;

  @BelongsTo(() => AddOnGroup)
  addOnGroup: AddOnGroup | null;

  @HasMany(() => ProductVariation)
  variations: ProductVariation[];

  @HasMany(() => ProductComboItem, "comboProductId")
  comboItems: ProductComboItem[];

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default Product;
