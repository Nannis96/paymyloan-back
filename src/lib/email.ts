import { env } from "@/config/env";
import { logger } from "@/lib/logger";

export type EmailTemplate = "welcome-borrower" | "password-reset" | "terms-updated" | "account-activated" | "terms-rejected" | "loan-quote-selected";

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
  // BE-061. Un Deudor rechazó la versión vigente — el contrato vuelve a
  // DRAFT para que el Prestamista la revise y reenvíe (08-contratos.md §8.1).
  "terms-rejected": (data) =>
    `<p>El deudor ${data.borrowerName} rechazó los términos propuestos del contrato ${data.contractNumber}` +
    `${data.comment ? `, con el comentario: "${data.comment}"` : ""}. ` +
    `Ingresa a PayMyLoan para revisarlos y proponer una nueva versión.</p>`,
  // D-P2-1: el auto-registrado no elige contraseña — nace inactivo y esta
  // es la plantilla que recibe al activarlo un Admin, con la contraseña
  // temporal generada en ese momento (adminUsers.service.ts).
  "account-activated": (data) =>
    `<p>Hola ${data.name},</p>` +
    `<p>Tu cuenta de PayMyLoan ya está activa. Tu contraseña temporal es <strong>${data.temporaryPassword}</strong>; ` +
    `te la va a pedir cambiar al iniciar sesión por primera vez.</p>`,
  // PB-017 (D-P5-3). El Borrower seleccionó esta cotización — el contrato en
  // DRAFT ya existe, falta que el Lender lo revise/complete y lo envíe a
  // firma (POST .../terms/:termsId/submit).
  "loan-quote-selected": (data) =>
    `<p>Tu cotización para la solicitud de préstamo fue seleccionada por el deudor. ` +
    `Ya se creó el contrato ${data.contractNumber} en borrador — ingresa a PayMyLoan para revisarlo, completarlo y enviarlo a firma.</p>`,
};

// Wrapper agnóstico de proveedor (BE-006): el resto del código solo llama a
// sendEmail(). El proveedor concreto sigue pendiente de confirmar (plan de
// backend, sección 15) — Resend detrás de EMAIL_PROVIDER como placeholder,
// cambiarlo es tocar solo este archivo.
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const html = TEMPLATES[input.template](input.data);

  // Sin EMAIL_API_KEY no hay forma de llamar a Resend de verdad — en vez de
  // fallar (lo que dejaría intransitable el flujo de activación en
  // desarrollo/test, ver D-P2-1), se loguea el correo completo. Nunca pasa
  // en producción: BE-002 exige las variables reales ahí.
  if (!env.emailApiKey) {
    logger.info("Correo simulado (EMAIL_API_KEY vacío, no se llamó a Resend)", {
      to: input.to,
      subject: input.subject,
      template: input.template,
      html,
    });
    return;
  }

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
