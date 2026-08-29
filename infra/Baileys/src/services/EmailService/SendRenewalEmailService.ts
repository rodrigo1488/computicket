import nodemailer from "nodemailer";
import Company from "../../models/Company";
import Plan from "../../models/Plan";
import { logger } from "../../utils/logger";
import moment from "moment";

interface SendRenewalEmailData {
  company: Company;
  plan: Plan;
  preferenceUrl: string;
  dueDate: string;
  newDueDate: string;
}

const SendRenewalEmailService = async (data: SendRenewalEmailData): Promise<void> => {
  const { company, plan, preferenceUrl, dueDate, newDueDate } = data;

  try {
    // Configurar transporter de email
    const urlSmtp = process.env.MAIL_HOST;
    const userSmtp = process.env.MAIL_USER;
    const passwordSmpt = process.env.MAIL_PASS;
    const fromEmail = process.env.MAIL_FROM;

    if (!urlSmtp || !userSmtp || !passwordSmpt || !fromEmail) {
      logger.warn("Configurações de email não encontradas. Email de renovação não será enviado.");
      return;
    }

    const transporter = nodemailer.createTransport({
      host: urlSmtp,
      port: Number(process.env.MAIL_PORT) || 465,
      secure: true,
      auth: {
        user: userSmtp,
        pass: passwordSmpt,
      },
    });

    // Template HTML do email
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
          }
          .container {
            background: linear-gradient(145deg, #ffffff, #f9fafb);
            border-radius: 12px;
            padding: 40px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            border: 1px solid #e5e7eb;
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #00D9FF;
          }
          .logo {
            font-size: 24px;
            font-weight: 700;
            background: linear-gradient(135deg, #00D9FF, #22C55E);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 10px;
          }
          .title {
            font-size: 22px;
            font-weight: 600;
            color: #1f2937;
            margin: 20px 0;
          }
          .content {
            color: #4b5563;
            margin: 20px 0;
          }
          .info-box {
            background: rgba(0, 217, 255, 0.1);
            border-left: 4px solid #00D9FF;
            padding: 15px;
            margin: 20px 0;
            border-radius: 6px;
          }
          .info-item {
            margin: 10px 0;
            display: flex;
            justify-content: space-between;
          }
          .info-label {
            font-weight: 600;
            color: #374151;
          }
          .info-value {
            color: #1f2937;
          }
          .button {
            display: inline-block;
            padding: 14px 32px;
            background: linear-gradient(135deg, #00D9FF, #22C55E);
            color: #0A0A0F;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            text-align: center;
            margin: 30px 0;
            box-shadow: 0 4px 15px rgba(0, 217, 255, 0.3);
            transition: all 0.3s ease;
          }
          .button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0, 217, 255, 0.4);
          }
          .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            color: #6b7280;
            font-size: 14px;
          }
          .warning {
            background: rgba(245, 158, 11, 0.1);
            border-left: 4px solid #F59E0B;
            padding: 15px;
            margin: 20px 0;
            border-radius: 6px;
            color: #92400e;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">CompuChat</div>
            <h1 class="title">Renovação de Assinatura</h1>
          </div>
          
          <div class="content">
            <p>Olá <strong>${company.name}</strong>,</p>
            
            <p>Sua assinatura está próxima do vencimento e precisa ser renovada para continuar utilizando nossos serviços.</p>
            
            <div class="info-box">
              <div class="info-item">
                <span class="info-label">Plano:</span>
                <span class="info-value">${plan.name}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Valor:</span>
                <span class="info-value">R$ ${plan.value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Vencimento Atual:</span>
                <span class="info-value">${dueDate}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Novo Vencimento:</span>
                <span class="info-value">${newDueDate}</span>
              </div>
            </div>
            
            <div class="warning">
              <strong>⚠️ Importante:</strong> Para evitar interrupção dos serviços, realize o pagamento antes do vencimento.
            </div>
            
            <div style="text-align: center;">
              <a href="${preferenceUrl}" class="button">Renovar Assinatura Agora</a>
            </div>
            
            <p style="margin-top: 30px; color: #6b7280; font-size: 14px;">
              Se você não conseguir clicar no botão, copie e cole o link abaixo no seu navegador:<br>
              <a href="${preferenceUrl}" style="color: #00D9FF; word-break: break-all;">${preferenceUrl}</a>
            </p>
          </div>
          
          <div class="footer">
            <p>Este é um email automático de renovação de assinatura.</p>
            <p>Se você tiver dúvidas, entre em contato conosco.</p>
            <p style="margin-top: 20px; color: #9ca3af;">
              © ${new Date().getFullYear()} CompuChat. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Texto alternativo (plain text)
    const textContent = `
Renovação de Assinatura - CompuChat

Olá ${company.name},

Sua assinatura está próxima do vencimento e precisa ser renovada.

Detalhes:
- Plano: ${plan.name}
- Valor: R$ ${plan.value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
- Vencimento Atual: ${dueDate}
- Novo Vencimento: ${newDueDate}

Para renovar sua assinatura, acesse o link abaixo:
${preferenceUrl}

Importante: Para evitar interrupção dos serviços, realize o pagamento antes do vencimento.

Este é um email automático de renovação de assinatura.
Se você tiver dúvidas, entre em contato conosco.

© ${new Date().getFullYear()} CompuChat. Todos os direitos reservados.
    `;

    const mailOptions = {
      from: `"CompuChat" <${fromEmail}>`,
      to: company.email,
      subject: `Renovação de Assinatura - Vencimento em ${dueDate}`,
      text: textContent,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Email de renovação enviado para ${company.email}:`, {
      messageId: info.messageId,
      companyId: company.id,
    });
  } catch (error: any) {
    logger.error(`Erro ao enviar email de renovação para ${company.email}:`, error);
    // Não lançar erro para não interromper o processo de renovação
    // O email é importante mas não crítico
  }
};

export default SendRenewalEmailService;
