import Whatsapp from "../../models/Whatsapp";

export interface SendMessageOptions {
  quotedMsg?: any;
  [key: string]: any;
}

export interface SendMediaOptions {
  fileName?: string;
  caption?: string;
  mimetype?: string;
  [key: string]: any;
}

export interface IWhatsAppProvider {
  /**
   * Envia uma mensagem de texto.
   * @param number - Número de destino ou JID completo (ex.: 5511999999999@s.whatsapp.net ou 120363123456789@g.us).
   *                 Quando a chamada vem de um ticket, use getChatJid(ticket) para garantir grupo vs privado.
   */
  sendMessage(
    whatsapp: Whatsapp,
    number: string,
    body: string,
    options?: SendMessageOptions
  ): Promise<any>;

  /**
   * Envia uma mídia (imagem, vídeo, áudio, documento).
   * @param number - Número de destino ou JID completo (ex.: 5511999999999@s.whatsapp.net ou 120363123456789@g.us).
   *                 Quando a chamada vem de um ticket, use getChatJid(ticket).
   */
  sendMedia(
    whatsapp: Whatsapp,
    number: string,
    mediaPath: string,
    options?: SendMediaOptions
  ): Promise<any>;

  /**
   * Obtém o status da conexão
   */
  getStatus(whatsapp: Whatsapp): Promise<string>;
}

