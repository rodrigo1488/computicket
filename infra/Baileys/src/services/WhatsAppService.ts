import Whatsapp from "../models/Whatsapp";
import { getWhatsAppProvider } from "../providers";
import {
  IWhatsAppProvider,
  SendMessageOptions,
  SendMediaOptions
} from "../providers/whatsapp/IWhatsAppProvider";
import AppError from "../errors/AppError";

class WhatsAppService {
  /**
   * Obtém o provider correto para o Whatsapp
   */
  private getProvider(whatsapp: Whatsapp): IWhatsAppProvider {
    return getWhatsAppProvider(whatsapp);
  }

  /**
   * Envia uma mensagem de texto
   */
  async sendMessage(
    whatsappId: number,
    number: string,
    body: string,
    options?: SendMessageOptions
  ): Promise<any>;
  async sendMessage(
    whatsapp: Whatsapp,
    number: string,
    body: string,
    options?: SendMessageOptions
  ): Promise<any>;
  async sendMessage(
    whatsappOrId: Whatsapp | number,
    number: string,
    body: string,
    options?: SendMessageOptions
  ): Promise<any> {
    const whatsapp = await this.resolveWhatsapp(whatsappOrId);
    const provider = this.getProvider(whatsapp);
    // Se já for JID completo (ex.: de getChatJid(ticket)), repassa como está
    const destination = number.includes("@") ? number : number.replace(/@.*$/, "").replace(/\D/g, "");
    return provider.sendMessage(whatsapp, destination, body, options);
  }

  /**
   * Envia uma mídia
   */
  async sendMedia(
    whatsappId: number,
    number: string,
    mediaPath: string,
    options?: SendMediaOptions
  ): Promise<any>;
  async sendMedia(
    whatsapp: Whatsapp,
    number: string,
    mediaPath: string,
    options?: SendMediaOptions
  ): Promise<any>;
  async sendMedia(
    whatsappOrId: Whatsapp | number,
    number: string,
    mediaPath: string,
    options?: SendMediaOptions
  ): Promise<any> {
    const whatsapp = await this.resolveWhatsapp(whatsappOrId);
    const provider = this.getProvider(whatsapp);
    const destination = number.includes("@") ? number : number.replace(/@.*$/, "").replace(/\D/g, "");
    return provider.sendMedia(whatsapp, destination, mediaPath, options);
  }

  /**
   * Obtém o status da conexão
   */
  async getStatus(whatsappId: number): Promise<string>;
  async getStatus(whatsapp: Whatsapp): Promise<string>;
  async getStatus(whatsappOrId: Whatsapp | number): Promise<string> {
    const whatsapp = await this.resolveWhatsapp(whatsappOrId);
    const provider = this.getProvider(whatsapp);
    return provider.getStatus(whatsapp);
  }

  /**
   * Resolve Whatsapp de ID ou objeto
   */
  private async resolveWhatsapp(
    whatsappOrId: Whatsapp | number
  ): Promise<Whatsapp> {
    // Verificar se é um objeto Whatsapp (tem propriedade id e não é número)
    if (typeof whatsappOrId === "object" && whatsappOrId !== null && "id" in whatsappOrId) {
      return whatsappOrId as Whatsapp;
    }

    // Caso contrário, é um número (ID)
    const whatsapp = await Whatsapp.findByPk(whatsappOrId as number);
    if (!whatsapp) {
      throw new AppError("ERR_WAPP_NOT_FOUND");
    }

    return whatsapp;
  }
}

export default new WhatsAppService();

