import * as Yup from "yup";

import AppError from "../../errors/AppError";
import QueueIntegrations from "../../models/QueueIntegrations";


interface Request {
  type: string;
  name: string;
  projectName: string;
  jsonContent: string;
  language: string;
  urlN8N?: string;
  companyId: number;
  typebotSlug?: string;
  typebotExpires?: number;
  typebotKeywordFinish?: string;
  typebotUnknownMessage?: string;
  typebotDelayMessage?: number;
  typebotKeywordRestart?: string;
  typebotRestartMessage?: string;
}

const CreateQueueIntegrationService = async ({
  type,
  name,
  projectName,
  jsonContent,
  language,
  urlN8N,
  companyId,
  typebotExpires,
  typebotKeywordFinish,
  typebotSlug,
  typebotUnknownMessage,
  typebotDelayMessage,
  typebotKeywordRestart,
  typebotRestartMessage
}: Request): Promise<QueueIntegrations> => {
  const resolvedLanguage =
    language && String(language).trim() ? String(language).trim() : "pt-BR";

  let resolvedJsonContent =
    jsonContent != null && String(jsonContent).trim() !== ""
      ? String(jsonContent)
      : "";

  // flowbuilder / n8n / webhook exigem jsonContent NOT NULL no Postgres
  if (!resolvedJsonContent) {
    if (type === "flowbuilder") {
      resolvedJsonContent = JSON.stringify({});
    } else {
      resolvedJsonContent = "{}";
    }
  }

  const schema = Yup.object().shape({
    name: Yup.string()
      .required()
      .min(2)
      .test(
        "Check-name",
        "This integration name is already used.",
        async value => {
          if (!value) return false;
          const nameExists = await QueueIntegrations.findOne({
            where: { name: value, companyId }
          });
          return !nameExists;
        }
      )
  });

  try {
    await schema.validate({
      type,
      name,
      projectName,
      jsonContent: resolvedJsonContent,
      language: resolvedLanguage,
      urlN8N,
      companyId
    });
  } catch (err) {
    throw new AppError(err.message);
  }


  const queueIntegration = await QueueIntegrations.create(
    {
      type,
      name,
      projectName,
      jsonContent: resolvedJsonContent,
      language: resolvedLanguage,
      urlN8N: urlN8N || "",
      companyId,
      typebotExpires,
      typebotKeywordFinish,
      typebotSlug,
      typebotUnknownMessage,
      typebotDelayMessage,
      typebotKeywordRestart,
      typebotRestartMessage
    }
  );

  return queueIntegration;
};

export default CreateQueueIntegrationService;