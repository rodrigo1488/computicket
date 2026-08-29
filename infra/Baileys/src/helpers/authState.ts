import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataTypeMap
} from "baileys";
import Whatsapp from "../models/Whatsapp";
import { logger } from "../utils/logger";
import { loadBaileys } from "../libs/baileysModule";

const KEY_MAP: { [T in keyof SignalDataTypeMap]: string } = {
  "pre-key": "preKeys",
  session: "sessions",
  "sender-key": "senderKeys",
  "app-state-sync-key": "appStateSyncKeys",
  "app-state-sync-version": "appStateVersions",
  "sender-key-memory": "senderKeyMemory",
  "lid-mapping": "lidMapping",
  "device-list": "deviceList",
  tctoken: "tctoken",
  "identity-key": "identityKeys"
};

// Serializa gravações de estado por sessão para evitar sobrescrita concorrente
const authSaveLocks = new Map<number, Promise<void>>();

const authState = async (
  whatsapp: Whatsapp
): Promise<{ state: AuthenticationState; saveState: () => void }> => {
  const { BufferJSON, initAuthCreds } = await loadBaileys();

  let creds: AuthenticationCreds;
  let keys: any = {};

  const saveState = async () => {
    try {
      // Validação de integridade antes de persistir:
      // Garante que as credenciais essenciais do protocolo Noise/Signal estão presentes.
      // Salvar creds corrompidas/nulas causaria loop de auth inválido na próxima inicialização.
      if (!creds?.noiseKey || !creds?.signedIdentityKey) {
        logger.warn({
          msg: "authState: saveState abortado — creds sem campos obrigatórios (noiseKey/signedIdentityKey). Sessão não será sobrescrita.",
          whatsappId: whatsapp.id,
          hasNoiseKey: !!creds?.noiseKey,
          hasSignedIdentityKey: !!creds?.signedIdentityKey
        });
        return;
      }
      const previous = authSaveLocks.get(whatsapp.id) ?? Promise.resolve();

      const current = previous
        .catch(() => undefined)
        .then(async () => {
          await whatsapp.update({
            session: JSON.stringify({ creds, keys }, BufferJSON.replacer, 0)
          });
        });

      authSaveLocks.set(whatsapp.id, current);
      await current;

      if (authSaveLocks.get(whatsapp.id) === current) {
        authSaveLocks.delete(whatsapp.id);
      }
    } catch (error) {
      logger.error({
        msg: "authState: erro ao salvar sessão no banco.",
        whatsappId: whatsapp.id,
        error
      });
    }
  };

  // const getSessionDatabase = await whatsappById(whatsapp.id);

  if (whatsapp.session && whatsapp.session !== null) {
    try {
      const result = JSON.parse(whatsapp.session, BufferJSON.reviver);
      // Verificar se o JSON parseado contém dados mínimos válidos
      if (result?.creds?.noiseKey && result?.creds?.signedIdentityKey) {
        creds = result.creds;
        keys = result.keys ?? {};
      } else {
        logger.warn({
          msg: "authState: sessão no banco está corrompida ou incompleta. Iniciando nova sessão (novo QR necessário).",
          whatsappId: whatsapp.id,
          hasCredsObject: !!result?.creds
        });
        creds = initAuthCreds();
        keys = {};
      }
    } catch (parseError) {
      logger.error({
        msg: "authState: falha ao fazer parse da sessão salva. Iniciando nova sessão (novo QR necessário).",
        whatsappId: whatsapp.id,
        error: parseError
      });
      creds = initAuthCreds();
      keys = {};
    }
  } else {
    creds = initAuthCreds();
    keys = {};
  }

  return {
    state: {
      creds,
      keys: {
        get: (type, ids) => {
          const key = KEY_MAP[type];
          return ids.reduce((dict: any, id) => {
            let value = keys[key]?.[id];
            if (value) {
              // No Baileys v7, o BufferJSON.reviver já faz a conversão necessária
              // Não precisamos mais converter app-state-sync-key manualmente
              dict[id] = value;
            }
            return dict;
          }, {});
        },
        set: (data: any) => {
          // eslint-disable-next-line no-restricted-syntax, guard-for-in
          for (const i in data) {
            const key = KEY_MAP[i as keyof SignalDataTypeMap];
            keys[key] = keys[key] || {};
            Object.assign(keys[key], data[i]);
          }
          // Salvar estado de forma assíncrona para não bloquear
          // O BufferJSON.replacer garante serialização correta
          setImmediate(() => saveState());
        }
      }
    },
    saveState
  };
};

export default authState;
