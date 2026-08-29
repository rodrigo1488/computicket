import * as Yup from "yup";
import AppError from "../../errors/AppError";
import Company from "../../models/Company";
import User from "../../models/User";
import Setting from "../../models/Setting";
import { hash } from "bcryptjs";

interface CompanyData {
  name: string;
  phone?: string;
  email?: string;
  password?: string;
  status?: boolean;
  planId?: number;
  campaignsEnabled?: boolean;
  dueDate?: string;
  recurrence?: string;
}

const CreateCompanyService = async (
  companyData: CompanyData
): Promise<Company> => {
  const {
    name,
    phone,
    email,
    status,
    planId,
    campaignsEnabled,
    dueDate,
    recurrence,
    password
  } = companyData;

  const companySchema = Yup.object().shape({
    name: Yup.string()
      .min(2, "ERR_COMPANY_INVALID_NAME")
      .required("ERR_COMPANY_INVALID_NAME")
      .test(
        "Check-unique-name",
        "ERR_COMPANY_NAME_ALREADY_EXISTS",
        async value => {
          if (value) {
            const companyWithSameName = await Company.findOne({
              where: { name: value }
            });

            return !companyWithSameName;
          }
          return false;
        }
      )
  });

  try {
    await companySchema.validate({ name });
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const company = await Company.create({
    name,
    phone,
    email,
    status,
    planId,
    dueDate,
    recurrence
  });

  const passwordHash = await hash(password || "123456", 8);

  await User.create({
    name: company.name,
    email: company.email,
    password: password,
    passwordHash,
    profile: "admin",
    companyId: company.id
  });

  await Setting.findOrCreate({
    where: {
      companyId: company.id,
      key: "asaas"
    },
    defaults: {
      companyId: company.id,
      key: "asaas",
      value: ""
    },
  });

  //tokenixc
  await Setting.findOrCreate({
    where: {
      companyId: company.id,
      key: "tokenixc"
    },
    defaults: {
      companyId: company.id,
      key: "tokenixc",
      value: ""
    },
  });

  //ipixc
  await Setting.findOrCreate({
    where: {
      companyId: company.id,
      key: "ipixc"
    },
    defaults: {
      companyId: company.id,
      key: "ipixc",
      value: ""
    },
  });

  //ipmkauth
  await Setting.findOrCreate({
    where: {
      companyId: company.id,
      key: "ipmkauth"
    },
    defaults: {
      companyId: company.id,
      key: "ipmkauth",
      value: ""
    },
  });

  //clientsecretmkauth
  await Setting.findOrCreate({
    where: {
      companyId: company.id,
      key: "clientsecretmkauth"
    },
    defaults: {
      companyId: company.id,
      key: "clientsecretmkauth",
      value: ""
    },
  });

  //clientidmkauth
  await Setting.findOrCreate({
    where: {
      companyId: company.id,
      key: "clientidmkauth"
    },
    defaults: {
      companyId: company.id,
      key: "clientidmkauth",
      value: ""
    },
  });

  //CheckMsgIsGroup
  await Setting.findOrCreate({
    where: {
      companyId: company.id,
      key: "CheckMsgIsGroup"
    },
    defaults: {
      companyId: company.id,
      key: "CheckMsgIsGroup",
      value: "enabled"
    },
  });

  //CheckMsgIsGroup
  await Setting.findOrCreate({
    where: {
      companyId: company.id,
      key: "call"
    },
    defaults: {
      companyId: company.id,
      key: "call",
      value: "disabled"
    },
  });

  //scheduleType
  await Setting.findOrCreate({
    where: {
      companyId: company.id,
      key: "scheduleType"
    },
    defaults: {
      companyId: company.id,
      key: "scheduleType",
      value: "disabled"
    },
  });

  await Setting.findOrCreate({
    where: { companyId: company.id, key: "uniplusEnabled" },
    defaults: { companyId: company.id, key: "uniplusEnabled", value: "disabled" },
  });
  await Setting.findOrCreate({
    where: { companyId: company.id, key: "uniplusIdFilial" },
    defaults: { companyId: company.id, key: "uniplusIdFilial", value: "1" },
  });
  await Setting.findOrCreate({
    where: { companyId: company.id, key: "uniplusIdUsuario" },
    defaults: { companyId: company.id, key: "uniplusIdUsuario", value: "1" },
  });
  await Setting.findOrCreate({
    where: { companyId: company.id, key: "uniplusPaymentMap" },
    defaults: {
      companyId: company.id,
      key: "uniplusPaymentMap",
      value: JSON.stringify({
        pix: "valorpix",
        dinheiro: "valordinheiro",
        cartao: "valorcartao",
        outro: "valoroutros",
      }),
    },
  });
  await Setting.findOrCreate({
    where: { companyId: company.id, key: "uniplusPrintDeviceId" },
    defaults: { companyId: company.id, key: "uniplusPrintDeviceId", value: "" },
  });

 // Enviar mensagem ao aceitar ticket
    await Setting.findOrCreate({
	where:{
      companyId: company.id,
      key: "sendGreetingAccepted",
    },
    defaults: {
      companyId: company.id,
      key: "sendGreetingAccepted",
      value: "disabled"
    },
  });

 // Limitar saudação da conexão (1x / 24h ou ao reabrir chat encerrado)
    await Setting.findOrCreate({
	where:{
      companyId: company.id,
      key: "limitConnectionGreeting",
    },
    defaults: {
      companyId: company.id,
      key: "limitConnectionGreeting",
      value: "disabled"
    },
  });

 // Enviar mensagem de transferencia
    await Setting.findOrCreate({
	where:{
      companyId: company.id,
      key: "sendMsgTransfTicket",
    },
    defaults: {
      companyId: company.id,
      key: "sendMsgTransfTicket",
      value: "disabled"
    },
 });

  //userRating
  await Setting.findOrCreate({
    where: {
      companyId: company.id,
      key: "userRating"
    },
    defaults: {
      companyId: company.id,
      key: "userRating",
      value: "disabled"
    },
  });

  //userRating
  await Setting.findOrCreate({
    where: {
      companyId: company.id,
      key: "chatBotType"
    },
    defaults: {
      companyId: company.id,
      key: "chatBotType",
      value: "text"
    },

  });

  await Setting.findOrCreate({
    where: {
      companyId: company.id,
      key: "tokensgp"
    },
    defaults: {
      companyId: company.id,
      key: "tokensgp",
      value: ""
    },
  });

  await Setting.findOrCreate({
    where: {
      companyId: company.id,
      key: "ipsgp"
    },
    defaults: {
      companyId: company.id,
      key: "ipsgp",
      value: ""
    },
  });

  await Setting.findOrCreate({
    where: {
      companyId: company.id,
      key: "appsgp"
    },
    defaults: {
      companyId: company.id,
      key: "appsgp",
      value: ""
    },
  });

  if (companyData.campaignsEnabled !== undefined) {
    const [setting, created] = await Setting.findOrCreate({
      where: {
        companyId: company.id,
        key: "campaignsEnabled"
      },
      defaults: {
        companyId: company.id,
        key: "campaignsEnabled",
        value: `${campaignsEnabled}`
      },

    });
    if (!created) {
      await setting.update({ value: `${campaignsEnabled}` });
    }
  }

  return company;
};

export default CreateCompanyService;
