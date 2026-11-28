import nodemailer, { type Transporter } from 'nodemailer';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isSmtpConfigured(): boolean {
  const host = (process.env.SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  return Boolean(host && user && pass);
}

let cachedEtherealAccount: { user: string; pass: string } | null = null;

async function getMailTransporter(): Promise<{
  transporter: Transporter;
  from: string;
  isTestInbox: boolean;
} | null> {
  if (isSmtpConfigured()) {
    const host = (process.env.SMTP_HOST || '').trim();
    const port = Number(process.env.SMTP_PORT || 587);
    const secure =
      process.env.SMTP_SECURE === 'true' ||
      port === 465;
    const user = (process.env.SMTP_USER || '').trim();
    const pass = (process.env.SMTP_PASS || '').trim();
    const from = (process.env.SMTP_FROM || `R&P Tabacaria <${user}>`).trim();

    return {
      transporter: nodemailer.createTransport({
        host,
        port: Number.isFinite(port) && port > 0 ? port : 587,
        secure,
        auth: { user, pass },
      }),
      from,
      isTestInbox: false,
    };
  }

  // Fallback sandbox inbox (Ethereal) when SMTP secrets are not configured yet
  try {
    if (!cachedEtherealAccount) {
      const account = await nodemailer.createTestAccount();
      cachedEtherealAccount = { user: account.user, pass: account.pass };
    }
    return {
      transporter: nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: cachedEtherealAccount,
      }),
      from: 'R&P Tabacaria <no-reply@rptabacaria.local>',
      isTestInbox: true,
    };
  } catch {
    return null;
  }
}

export async function sendPasswordResetEmail(params: {
  toEmail: string;
  recipientName: string;
  resetUrl: string;
}): Promise<{ delivered: boolean; previewUrl?: string }> {
  const parsedUrl = new URL(params.resetUrl);
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Invalid reset URL protocol');
  }

  const setup = await getMailTransporter();
  if (!setup) {
    console.warn(
      '[Mailer] SMTP não configurado (defina SMTP_HOST, SMTP_USER e SMTP_PASS nos Segredos para envio real de e-mails).'
    );
    return { delivered: false };
  }

  const safeName = escapeHtml(params.recipientName || 'Cliente');
  const safeHref = escapeHtml(parsedUrl.toString());

  const subject = 'R&P Tabacaria · Recuperação de senha';
  const text = [
    `Olá, ${params.recipientName || 'Cliente'}!`,
    '',
    'Recebemos uma solicitação para redefinir a senha da sua conta na R&P Tabacaria.',
    'Acesse o link abaixo para cadastrar uma nova senha (válido por 30 minutos):',
    '',
    parsedUrl.toString(),
    '',
    'Se você não solicitou essa alteração, ignore este e-mail. Sua senha atual permanecerá segura.',
  ].join('\n');

  const html = `
    <div style="background:#000000;color:#ffffff;font-family:Arial,Helvetica,sans-serif;padding:32px 16px;">
      <div style="max-width:520px;margin:0 auto;background:#0e0e0e;border:1px solid #262626;border-radius:20px;padding:28px;">
        <p style="margin:0 0 8px;font-size:11px;letter-spacing:2px;color:#9e9e9e;font-weight:700;">R&amp;P TABACARIA</p>
        <h1 style="margin:0 0 16px;font-size:22px;color:#ffffff;">Recuperação de senha</h1>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#e5e5e5;">
          Olá, <strong>${safeName}</strong>! Recebemos uma solicitação para alterar a senha da sua conta.
        </p>
        <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#9e9e9e;">
          Clique no botão abaixo para criar uma nova senha. Este link expira em <strong>30 minutos</strong> e só pode ser usado uma vez.
        </p>
        <a href="${safeHref}" style="display:inline-block;background:#ffffff;color:#000000;text-decoration:none;font-weight:700;font-size:14px;padding:13px 24px;border-radius:12px;">
          Redefinir minha senha
        </a>
        <p style="margin:22px 0 6px;font-size:12px;color:#9e9e9e;">Se o botão não abrir, copie e cole este endereço no navegador:</p>
        <p style="margin:0;font-size:12px;word-break:break-all;color:#d4d4d4;">${safeHref}</p>
        <hr style="border:none;border-top:1px solid #262626;margin:24px 0 16px;" />
        <p style="margin:0;font-size:12px;color:#9e9e9e;">
          Se você não solicitou a recuperação de senha, apenas ignore este e-mail.
        </p>
      </div>
    </div>
  `;

  try {
    const info = await setup.transporter.sendMail({
      from: setup.from,
      to: params.toEmail,
      subject,
      text,
      html,
    });

    if (setup.isTestInbox) {
      const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;
      if (previewUrl) {
        console.info(`[Mailer] E-mail de teste (Ethereal) gerado para visualização: ${previewUrl}`);
      }
      return { delivered: true, previewUrl };
    }
    return { delivered: true };
  } catch (err) {
    console.error('[Mailer] Falha ao enviar e-mail de recuperação:', err);
    return { delivered: false };
  }
}

function getSafeStoreUrl(): string | null {
  const raw = (process.env.APP_URL || '').trim();
  if (!raw || raw === 'MY_APP_URL') return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export async function sendRouletteCouponExpiringEmail(params: {
  toEmail: string;
  recipientName: string;
  couponCode: string;
  benefitLabel: string;
  expiresAtIso: string;
}): Promise<{ delivered: boolean; previewUrl?: string }> {
  const cleanEmail = params.toEmail.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    console.warn(`[Mailer] E-mail inválido ignorado no lembrete de cupom: ${cleanEmail}`);
    return { delivered: false };
  }

  const setup = await getMailTransporter();
  if (!setup) {
    console.warn(
      '[Mailer] SMTP não configurado (defina SMTP_HOST, SMTP_USER e SMTP_PASS nos Segredos para envio real de e-mails).'
    );
    return { delivered: false };
  }

  const expiresDate = new Date(params.expiresAtIso);
  const formattedExpiry = Number.isNaN(expiresDate.getTime())
    ? params.expiresAtIso
    : new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'America/Sao_Paulo',
      }).format(expiresDate);

  const recipientName = params.recipientName.trim() || 'Cliente';
  const couponCode = params.couponCode.trim().toUpperCase();
  const benefitLabel = params.benefitLabel.trim();
  const storeUrl = getSafeStoreUrl();

  const safeName = escapeHtml(recipientName);
  const safeCode = escapeHtml(couponCode);
  const safeBenefit = escapeHtml(benefitLabel);
  const safeExpiry = escapeHtml(formattedExpiry);
  const safeStoreUrl = storeUrl ? escapeHtml(storeUrl) : null;

  const subject = `R&P Tabacaria · Falta só 1 dia para usar seu cupom ${couponCode}!`;
  const text = [
    `Olá, ${recipientName}!`,
    '',
    `Seu cupom exclusivo da Roleta R&P (${couponCode} · ${benefitLabel}) tem validade de 7 dias e chegou ao 6º dia.`,
    `Falta só 1 dia para você aproveitar antes que ele expire em ${formattedExpiry}.`,
    '',
    `Código do cupom: ${couponCode}`,
    ...(storeUrl ? ['', `Acesse a loja para usar agora: ${storeUrl}`] : []),
    '',
    'Aplique o código no carrinho ou no checkout antes do vencimento.',
  ].join('\n');

  const html = `
    <div style="background:#000000;color:#ffffff;font-family:Arial,Helvetica,sans-serif;padding:32px 16px;">
      <div style="max-width:520px;margin:0 auto;background:#0e0e0e;border:1px solid #262626;border-radius:20px;padding:28px;">
        <p style="margin:0 0 8px;font-size:11px;letter-spacing:2px;color:#9e9e9e;font-weight:700;">R&amp;P TABACARIA · ROLETA DE PRÊMIOS</p>
        <h1 style="margin:0 0 14px;font-size:22px;color:#ffffff;">Falta só 1 dia para usar seu cupom!</h1>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#e5e5e5;">
          Olá, <strong>${safeName}</strong>! Seu cupom da roleta completou 6 dias e está quase vencendo.
        </p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#9e9e9e;">
          Você tem apenas mais <strong style="color:#ffffff;">1 dia</strong> para aproveitar seu benefício antes que ele expire em <strong style="color:#ffffff;">${safeExpiry}</strong>.
        </p>
        <div style="background:#000000;border:1px dashed #525252;border-radius:14px;padding:18px;text-align:center;margin:0 0 20px;">
          <p style="margin:0 0 6px;font-size:11px;letter-spacing:1.5px;color:#9e9e9e;text-transform:uppercase;">Seu cupom exclusivo (${safeBenefit})</p>
          <p style="margin:0;font-size:24px;font-weight:800;letter-spacing:2px;color:#ffffff;">${safeCode}</p>
        </div>
        ${
          safeStoreUrl
            ? `<a href="${safeStoreUrl}" style="display:inline-block;background:#ffffff;color:#000000;text-decoration:none;font-weight:700;font-size:14px;padding:13px 24px;border-radius:12px;">Usar meu cupom agora</a>`
            : ''
        }
        <hr style="border:none;border-top:1px solid #262626;margin:24px 0 16px;" />
        <p style="margin:0;font-size:12px;color:#9e9e9e;">
          Válido para uso único na sua conta até ${safeExpiry}. Caso já tenha utilizado, desconsidere este aviso.
        </p>
      </div>
    </div>
  `;

  try {
    const info = await setup.transporter.sendMail({
      from: setup.from,
      to: cleanEmail,
      subject,
      text,
      html,
    });

    if (setup.isTestInbox) {
      const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;
      if (previewUrl) {
        console.info(`[Mailer] Lembrete de cupom (Ethereal) para ${cleanEmail}: ${previewUrl}`);
      }
      return { delivered: true, previewUrl };
    }
    return { delivered: true };
  } catch (err) {
    console.error(`[Mailer] Falha ao enviar lembrete de cupom ${couponCode}:`, err);
    return { delivered: false };
  }
}
