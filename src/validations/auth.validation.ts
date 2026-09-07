import { z } from "zod";
import { phone } from "@/validations/users.validation";

const email = z.email("Correo inválido").trim().toLowerCase();
const name = z.string().trim().min(1, "El nombre es obligatorio").max(120);
// bcrypt ignora silenciosamente todo lo que exceda 72 bytes (mismo límite
// que users.validation.ts) — se topa acá para que falle en validación y no
// en un hash truncado.
const newPassword = z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(72);
const totpCode = z.string().trim().min(1, "El código es obligatorio").max(64);

// PB-013 / D-P2-1: solo LENDER y BORROWER pueden auto-registrarse
// (D-P1-10) — sin contraseña, se genera y se envía por correo al activar.
export const registerSchema = z.object({
  name,
  email,
  phone,
  role: z.enum(["LENDER", "BORROWER"]),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "La contraseña es obligatoria").max(72),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const loginTwoFactorSchema = z.object({
  pendingToken: z.string().min(1, "Falta el pendingToken"),
  code: totpCode,
});
export type LoginTwoFactorInput = z.infer<typeof loginTwoFactorSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Falta el refreshToken"),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, "Falta el refreshToken"),
});
export type LogoutInput = z.infer<typeof logoutSchema>;

export const passwordForgotSchema = z.object({ email });
export type PasswordForgotInput = z.infer<typeof passwordForgotSchema>;

export const passwordResetSchema = z.object({
  token: z.string().min(1, "Falta el token"),
  newPassword,
});
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;

export const twoFactorVerifySchema = z.object({ code: totpCode });
export type TwoFactorVerifyInput = z.infer<typeof twoFactorVerifySchema>;

// BE-034: disable/recovery-codes exigen contraseña + código vigente, no
// solo la sesión activa — evita que una sesión robada por sí sola pueda
// desactivar 2FA o regenerar recovery codes.
export const twoFactorStepUpSchema = z.object({
  password: z.string().min(1, "La contraseña es obligatoria").max(72),
  code: totpCode,
});
export type TwoFactorStepUpInput = z.infer<typeof twoFactorStepUpSchema>;
