import Form from "../../models/Form";
import FormField from "../../models/FormField";
import AppError from "../../errors/AppError";
import HasCompanyModuleService, { MODULE_LANCHONETES } from "../CompanyModuleServices/HasCompanyModuleService";
import crypto from "crypto";

interface Field {
  id?: number;
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
  formId: number;
  companyId: number;
  name?: string;
  description?: string;
  fields?: Field[];
  primaryColor?: string;
  secondaryColor?: string;
  logoPosition?: string;
  logoUrl?: string;
  successMessage?: string;
  successRedirectUrl?: string;
  requireAuth?: boolean;
  allowMultipleSubmissions?: boolean;
  isAnonymous?: boolean;
  isActive?: boolean;
  createContact?: boolean;
  createTicket?: boolean;
  sendWebhook?: boolean;
  webhookUrl?: string;
  settings?: object;
}

const UpdateFormService = async ({
  formId,
  companyId,
  fields,
  ...formData
}: Request): Promise<Form> => {
  const form = await Form.findOne({
    where: { id: formId, companyId },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  // Garantir publicId para URLs públicas (segurança). Se por algum motivo estiver vazio, gerar.
  if (!(form as any).publicId) {
    (formData as any).publicId = crypto.randomBytes(16).toString("hex");
  }

  const newFormType = (formData.settings as any)?.formType ?? (form.settings as any)?.formType;
  if (newFormType === "cardapio") {
    const hasModule = await HasCompanyModuleService(companyId, MODULE_LANCHONETES);
    if (!hasModule) {
      throw new AppError("ERR_MODULE_LANCHONETES_REQUIRED", 403);
    }
  }

  // Salvar valores antigos antes de atualizar
  const oldIsQuotationForm = (form.settings as any)?.formType === "quotation";
  const oldIsMenuForm = (form.settings as any)?.formType === "cardapio";
  const oldIsAnonymous = form.isAnonymous;

    // Log para debug - verificar o que está sendo recebido
    if (formData.settings) {
      const settings = formData.settings as any;
      console.log("UpdateFormService: Received settings with mesaPrintConfig:", settings.mesaPrintConfig);
      console.log("UpdateFormService: Received settings with deliveryPrintDeviceIds:", settings.deliveryPrintDeviceIds);
      console.log("UpdateFormService: Received requireMesaOccupation:", settings.requireMesaOccupation);
      console.log("UpdateFormService: Full received settings:", JSON.stringify(settings, null, 2));
    }

  // Se settings foi fornecido, fazer merge com settings existente para preservar outros campos
  // IMPORTANTE: Arrays vazios devem ser substituídos, não preservados
  if (formData.settings) {
    const currentSettings = (form.settings as any) || {};
    const newSettingsData = formData.settings as any;
    
    // Fazer merge, mas substituir arrays vazios explicitamente
    const newSettings: any = {
      ...currentSettings,
      ...newSettingsData,
    };
    
    // Se mesaPrintConfig foi fornecido (mesmo que vazio), usar o valor fornecido
    if (newSettingsData.hasOwnProperty('mesaPrintConfig')) {
      newSettings.mesaPrintConfig = newSettingsData.mesaPrintConfig;
    }
    
    // Se deliveryPrintDeviceIds foi fornecido (mesmo que vazio), usar o valor fornecido
    if (newSettingsData.hasOwnProperty('deliveryPrintDeviceIds')) {
      newSettings.deliveryPrintDeviceIds = newSettingsData.deliveryPrintDeviceIds;
    }

    // Garantir que formType seja sempre preservado quando enviado (agendamento, cardapio, quotation, normal)
    if (newSettingsData.hasOwnProperty('formType') && newSettingsData.formType != null) {
      newSettings.formType = newSettingsData.formType;
    }
    
    // Garantir que requireMesaOccupation seja preservado quando enviado (pode ser false)
    if (newSettingsData.hasOwnProperty('requireMesaOccupation')) {
      newSettings.requireMesaOccupation = newSettingsData.requireMesaOccupation;
    }
    
    formData.settings = newSettings;
    console.log("UpdateFormService: Merged settings:", JSON.stringify(newSettings, null, 2));
    console.log("UpdateFormService: mesaPrintConfig in merged settings:", newSettings.mesaPrintConfig);
    console.log("UpdateFormService: requireMesaOccupation in merged settings:", newSettings.requireMesaOccupation);
  }

  // Se settings foi fornecido, garantir que seja salvo (via Sequelize para serialização correta do JSONB)
  if (formData.settings) {
    const { settings, ...otherFields } = formData;
    const updatePayload: any = { ...otherFields, settings: formData.settings };
    await form.update(updatePayload);
    await form.reload();
  } else {
    await form.update(formData);
    await form.reload();
  }
  
  // Log para debug - verificar o que foi salvo
  const savedSettings = form.settings as any;
  console.log("UpdateFormService: Saved settings with mesaPrintConfig:", savedSettings?.mesaPrintConfig);
  console.log("UpdateFormService: Saved settings with deliveryPrintDeviceIds:", savedSettings?.deliveryPrintDeviceIds);
  
  // Verificar diretamente no banco se necessário
  const rawForm = await Form.findByPk(formId, { 
    attributes: ['id', 'settings'],
    raw: false 
  });
  if (rawForm) {
    const rawSettings = (rawForm as any).settings;
    console.log("UpdateFormService: Raw settings from DB after save:", JSON.stringify(rawSettings, null, 2));
    console.log("UpdateFormService: mesaPrintConfig in raw settings:", rawSettings?.mesaPrintConfig);
  }

  // Verificar se é formulário de cotação ou cardápio (após atualização)
  const formSettings = form.settings as any;
  const isQuotationForm = formSettings?.formType === "quotation";
  const isMenuForm = formSettings?.formType === "cardapio";

  // Se mudou formType ou isAnonymous, recriar campos automáticos
  if (fields !== undefined || (isQuotationForm !== oldIsQuotationForm) || (isMenuForm !== oldIsMenuForm) || (oldIsAnonymous !== form.isAnonymous)) {
    // Delete all existing fields (incluindo campos automáticos se existirem)
    await FormField.destroy({
      where: { formId: form.id },
    });

    const fieldsToCreate: Field[] = [];
    // Mapear IDs antigos -> novos quando recriar campos.
    // Isso é importante porque settings (ex.: deliveryFeeCondition.fieldId) pode referenciar IDs
    // que serão invalidados após destroy + bulkCreate.
    const oldToNewFieldId: Record<number, number> = {};

    if (isQuotationForm) {
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
            order: (form.isAnonymous ? 0 : 2) + index,
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

      // Construir mapa old->new apenas para os campos "custom" vindos do payload (não automáticos).
      // A posição no array 'created' é estável: [autoFields..., payloadFields...]
      if (fields && fields.length > 0) {
        for (let i = 0; i < fields.length; i++) {
          const oldId = fields[i]?.id;
          const newId = created[baseIndex + i]?.id;
          if (oldId && newId) {
            oldToNewFieldId[Number(oldId)] = Number(newId);
          }
        }
      }

      for (let i = 0; i < fieldsToCreate.length; i++) {
        const field = fieldsToCreate[i] as any;
        if (typeof field.conditionalFieldIndex === "number" && field.hasConditional) {
          const sourceIdx = baseIndex + field.conditionalFieldIndex;
          if (sourceIdx >= 0 && sourceIdx < created.length && created[sourceIdx]) {
            await created[i].update({ conditionalFieldId: created[sourceIdx].id });
          }
        }
      }

      // Remapear settings.*.fieldId para os novos IDs, se necessário.
      const currentSettings: any = (form.settings as any) || {};
      const cond = currentSettings?.deliveryFeeCondition;
      const condFieldId = cond?.fieldId;
      const mapped = condFieldId != null ? oldToNewFieldId[Number(condFieldId)] : undefined;
      const triggerRules = Array.isArray(currentSettings?.orderTriggerMessages)
        ? currentSettings.orderTriggerMessages
        : [];
      const remappedTriggerRules = triggerRules.map((rule: any) => {
        const ruleFieldId = rule?.fieldId != null ? Number(rule.fieldId) : null;
        const mappedRuleFieldId = ruleFieldId != null ? oldToNewFieldId[ruleFieldId] : undefined;
        return mappedRuleFieldId
          ? { ...rule, fieldId: mappedRuleFieldId }
          : rule;
      });
      const triggerRulesChanged =
        JSON.stringify(remappedTriggerRules) !== JSON.stringify(triggerRules);

      const storedIds = Array.isArray(currentSettings?.pieceAgainStoredFieldIds)
        ? currentSettings.pieceAgainStoredFieldIds
        : [];
      const remappedStoredIds = storedIds
        .map((id: any) => oldToNewFieldId[Number(id)])
        .filter((id: number | undefined): id is number => id != null && id > 0);
      const storedIdsChanged =
        JSON.stringify(remappedStoredIds) !== JSON.stringify(storedIds);

      const printIds = Array.isArray(currentSettings?.printStoredFieldIds)
        ? currentSettings.printStoredFieldIds
        : [];
      const remappedPrintIds = printIds
        .map((id: any) => oldToNewFieldId[Number(id)])
        .filter((id: number | undefined): id is number => id != null && id > 0);
      const printIdsChanged =
        JSON.stringify(remappedPrintIds) !== JSON.stringify(printIds);

      if (mapped || triggerRulesChanged || storedIdsChanged || printIdsChanged) {
        const nextSettings: any = { ...currentSettings };
        if (mapped) {
          nextSettings.deliveryFeeCondition = {
            ...(cond || {}),
            fieldId: mapped,
          };
        }
        if (triggerRulesChanged) {
          nextSettings.orderTriggerMessages = remappedTriggerRules;
        }
        if (storedIdsChanged) {
          nextSettings.pieceAgainStoredFieldIds = remappedStoredIds;
        }
        if (printIdsChanged) {
          nextSettings.printStoredFieldIds = remappedPrintIds;
        }
        await form.update({ settings: nextSettings });
        await form.reload();
      }
    }
  }

  await form.reload({
    include: [{ association: "fields", order: [["order", "ASC"]] }],
  });

  return form;
};

export default UpdateFormService;
