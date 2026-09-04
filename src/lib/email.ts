import { env } from "@/config/env";
import { logger } from "@/lib/logger";

export type EmailTemplate = "welcome-borrower" | "password-reset" | "terms-updated";

export interface SendEmailInput {
  to: string;
  subject: string;
  template: EmailTemplate;
  data: Record<string, string>;
}

// Plantillas base (BE-006). Branding real llega con el motor de PDF/HTML de
// la Fase 11 (Documentos) — acá alcanza con HTML simple y transaccional.
const TEMPLATES: Record<EmailTemplate, (data: Record<string, string>) => string> = {
  "welcome-borrower": (data) =>
    `<p>Hola ${data.name},</p>` +
    `<p>Se creó tu cuenta en PayMyLoan. Tu contraseña temporal es <strong>${data.temporaryPassword}</strong>; ` +
    `te la va a pedir cambiar al iniciar sesión por primera vez.</p>`,
  "password-reset": (data) =>
    `<p>Para restablecer tu contraseña entra a <a href="${data.resetUrl}">${data.resetUrl}</a>. ` +
    `El enlace vence en 1 hora. Si no lo pediste, ignora este correo.</p>`,
  "terms-updated": (data) =>
    `<p>El prestamista propuso una nueva versión de los términos del contrato ${data.contractNumber}. ` +
    `Ingresa a PayMyLoan para revisarla y aceptarla o rechazarla.</p>`,
};

// Wrapper agnóstico de proveedor (BE-006): el resto del código solo llama a
// sendEmail(). El proveedor concreto sigue pendiente de confirmar (plan de
// backend, sección 15) — Resend detrás de EMAIL_PROVIDER como placeholder,
// cambiarlo es tocar solo este archivo.
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const html = TEMPLATES[input.template](input.data);

  switch (env.emailProvider) {
    case "resend":
      return sendViaResend({ to: input.to, subject: input.subject, html });
    default:
      throw new Error(`Proveedor de correo no soportado: ${env.emailProvider}`);
  }
}

async function sendViaResend(message: { to: string; subject: string; html: string }): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.emailApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.emailFrom,
      to: message.to,
      subject: message.subject,
      html: message.html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error("Fallo al enviar correo vía Resend", { status: response.status, body });
    throw new Error(`Resend respondió ${response.status}`);
  }
}
