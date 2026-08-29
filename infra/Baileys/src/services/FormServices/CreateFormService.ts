import Form from "../../models/Form";
import FormField from "../../models/FormField";
import AppError from "../../errors/AppError";
import HasCompanyModuleService, { MODULE_LANCHONETES } from "../CompanyModuleServices/HasCompanyModuleService";
import crypto from "crypto";

interface Field {
  label: string;
  fieldType: string;
  placeholder?: string;
  isRequired?: boolean;
  order: number;
  options?: string[];
  helpText?: string;
  validation?: object;
  hasConditional?: boolean;
  conditionalRules?: object;
  conditionalFieldId?: number;
  metadata?: object;
}

interface Request {
  name: string;
  description?: string;
  companyId: number;
  createdBy: number;
  fields?: Field[];
  isImport?: boolean; // Quando true, usa os campos fornecidos sem adicionar automáticos
  primaryColor?: string;
  secondaryColor?: string;
  logoPosition?: string;
  logoUrl?: string;
  successMessage?: string;
  successRedirectUrl?: string;
  requireAuth?: boolean;
  allowMultipleSubmissions?: boolean;
  isAnonymous?: boolean;
  createContact?: boolean;
  createTicket?: boolean;
  sendWebhook?: boolean;
  webhookUrl?: string;
  settings?: object;
}

const CreateFormService = async ({
  name,
  description,
  companyId,
  createdBy,
  fields,
  isImport = false,
  settings,
  ...otherSettings
}: Request): Promise<Form> => {
  const formType = (settings as any)?.formType;
  if (formType === "cardapio") {
    const hasModule = await HasCompanyModuleService(companyId, MODULE_LANCHONETES);
    if (!hasModule) {
      throw new AppError("ERR_MODULE_LANCHONETES_REQUIRED", 403);
    }
  }

  // Generate unique slug from name
  const baseSlug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  // Função para gerar hash único curto usando crypto
  const generateUniqueHash = (): string => {
    // Usar timestamp + random para garantir unicidade
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${random}`;
  };

  // Slug único global (necessário para URL pública /public/forms/:slug sem companyId)
  let finalSlug = baseSlug;
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const existingForm = await Form.findOne({
      where: { slug: finalSlug },
    });

    if (!existingForm) {
      break; // Slug é único, pode usar
    }
    
    // Gerar novo slug com hash único
    const hash = generateUniqueHash();
    finalSlug = `${baseSlug}-${hash}`;
    attempts++;
  }
  
  // Se ainda não encontrou um único após várias tentativas, usar timestamp + random mais longo
  if (attempts >= maxAttempts) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 12);
    finalSlug = `${baseSlug}-${timestamp}-${random}`;
  }

  // publicId (token público não adivinhável, usado em URLs públicas)
  const generatePublicId = (): string => crypto.randomBytes(16).toString("hex"); // 32 chars
  let publicId = generatePublicId();
  for (let i = 0; i < 5; i++) {
    const exists = await Form.findOne({ where: { publicId }, attributes: ["id"] });
    if (!exists) break;
    publicId = generatePublicId();
  }

  const form = await Form.create({
    name,
    description,
    slug: finalSlug,
    publicId,
    companyId,
    createdBy,
    settings,
    ...otherSettings,
  });

  // Verificar se é formulário de cotação ou cardápio
  const formSettings = form.settings as any;
  const isQuotationForm = formSettings?.formType === "quotation";
  const isMenuForm = formSettings?.formType === "cardapio";

  const fieldsToCreate: Field[] = [];

  // Na importação, usar apenas os campos fornecidos
  if (isImport && fields && fields.length > 0) {
    fields.forEach((field, index) => {
      fieldsToCreate.push({ ...field, order: field.order ?? index });
    });
  } else if (isQuotationForm) {
    // Para formulários de cotação, criar campos automáticos: Nome do Fornecedor, Telefone, Nome do Vendedor
    fieldsToCreate.push({
      label: "Nome do Fornecedor",
      fieldType: "text",
      placeholder: "Digite o nome do fornecedor",
      isRequired: true,
      order: 0,
      metadata: { isAutoField: true, autoFieldType: "supplierName" },
    } as Field);

    fieldsToCreate.push({
      label: "Telefone",
      fieldType: "phone",
      placeholder: "Digite o telefone (ex: 5534999999999)",
      isRequired: true,
      order: 1,
      metadata: { isAutoField: true, autoFieldType: "phone" },
    } as Field);

    fieldsToCreate.push({
      label: "Nome do Vendedor",
      fieldType: "text",
      placeholder: "Digite o nome do vendedor",
      isRequired: true,
      order: 2,
      metadata: { isAutoField: true, autoFieldType: "sellerName" },
      } as Field);
  } else if (isMenuForm) {
    // Para formulários de cardápio, criar campos automáticos: Nome e Telefone (obrigatórios)
    fieldsToCreate.push({
      label: "Nome",
      fieldType: "text",
      placeholder: "Digite seu nome",
      isRequired: true,
      order: 0,
      metadata: { isAutoField: true, autoFieldType: "name" },
    } as Field);

    fieldsToCreate.push({
      label: "Telefone",
      fieldType: "phone",
      placeholder: "Digite seu telefone (ex: 5534999999999)",
      isRequired: true,
      order: 1,
      metadata: { isAutoField: true, autoFieldType: "phone" },
    } as Field);

    // Campos customizados da aba finalizar serão adicionados pelo gestor
    if (fields && fields.length > 0) {
      fields.forEach((field, index) => {
        fieldsToCreate.push({
          ...field,
          order: 2 + index,
        });
      });
    }
  } else {
    // Se não for cotação nem cardápio, criar campos automáticos de Nome e Telefone se não for anônimo
    if (!form.isAnonymous) {
      // Campo Nome (primeiro)
      fieldsToCreate.push({
        label: "Nome",
        fieldType: "text",
        placeholder: "Digite seu nome",
        isRequired: true,
        order: 0,
        metadata: { isAutoField: true, autoFieldType: "name" },
      } as Field);
      
      // Campo Telefone (segundo)
      fieldsToCreate.push({
        label: "Telefone",
        fieldType: "phone",
        placeholder: "Digite seu telefone (ex: 5534999999999)",
        isRequired: true,
        order: 1,
        metadata: { isAutoField: true, autoFieldType: "phone" },
      } as Field);
    }

    // Adicionar campos customizados após os automáticos
    if (fields && fields.length > 0) {
      fields.forEach((field, index) => {
        fieldsToCreate.push({
          ...field,
          order: (form.isAnonymous ? 0 : 2) + index, // Ajustar ordem
        });
      });
    }
  }

  if (fieldsToCreate.length > 0) {
    const baseIndex = isQuotationForm ? 3 : (isMenuForm ? 2 : (form.isAnonymous ? 0 : 2));
    const fieldsToInsert = fieldsToCreate.map((field) => {
      const { conditionalFieldIndex, ...rest } = field as any;
      return { ...rest, formId: form.id };
    });
    const created = await FormField.bulkCreate(fieldsToInsert);
    for (let i = 0; i < fieldsToCreate.length; i++) {
      const field = fieldsToCreate[i] as any;
      if (typeof field.conditionalFieldIndex === "number" && field.hasConditional) {
        const sourceIdx = baseIndex + field.conditionalFieldIndex;
        if (sourceIdx >= 0 && sourceIdx < created.length && created[sourceIdx]) {
          await created[i].update({ conditionalFieldId: created[sourceIdx].id });
        }
      }
    }
  }

  // Reload form with fields
  const formWithFields = await Form.findByPk(form.id, {
    include: [
      {
        association: "fields",
        separate: true,
        order: [["order", "ASC"]],
      },
    ],
  });

  return formWithFields || form;
};

export default CreateFormService;
