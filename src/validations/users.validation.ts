import { z } from "zod";
import { paginationQuerySchema } from "@/validations/pagination";

// bcrypt ignora silenciosamente todo lo que exceda 72 bytes: se topa acá
// para que un password largo falle en validación y no en un hash truncado.
const password = z.string().min(8, "Password must be at least 8 characters").max(72);
const name = z.string().trim().min(1, "Name is required").max(120);
const email = z.email("Invalid email").trim().toLowerCase();
// D-P2-4: 10 dígitos exactos (formato local, sin `+`/espacios/guiones) —
// distinto del `contactPhone` de LenderCompany o el `phone` de
// BorrowerProfile, que son de la empresa/perfil, no de la cuenta.
export const phone = z
  .string()
  .trim()
  .regex(/^\d{10}$/, "Phone must be 10 digits")
  .optional();
// D-P4-5/D-P2-1: LENDER y BORROWER solo nacen por auto-registro
// (`POST /api/auth/register`), que crea User+LenderProfile/BorrowerProfile
// en una misma transacción — este CRUD genérico de Admin nunca crea esos
// perfiles, así que dejarlo aceptar esos roles deja un User sin su perfil
// (p.ej. invisible para `/api/admin/lenders/*`, que busca por LenderProfile).
// Acá solo quedan los roles de staff, que no tienen ese flujo dedicado.
const role = z.enum(["ADMIN", "BOOKKEEPER", "INSURANCE_COMPANY"]);
// D-P2-4: el Admin puede fijar el estado al crear/editar (antes solo lo
// tocaba /api/admin/users/:id/activate|deactivate). Sin default acá porque
// si no viene, updateUser/createUser no debe tocar el valor existente (o
// debe dejar que rija el default de Prisma, `true`, al crear).
const isActive = z.boolean().optional();

// D-P2-5: la creación nunca pide contraseña — nace sin una utilizable
// (igual que el auto-registro, D-P2-1) y, si `isActive` termina en `true`
// (explícito o por default), se genera una temporal de 8 dígitos y se
// devuelve en la respuesta (ver users.service.ts#createUser).
export const createUserSchema = z.object({ name, email, phone, role, isActive });
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({ name, email, phone, password, isActive })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Must include at least one field to update",
  });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// Autoservicio (`PATCH /api/auth/me`): un usuario edita su nombre, teléfono
// y — desde `D-P2-7` — su propio email. Nunca `password`/`role`/`isActive`
// desde acá (esos siguen con sus flujos propios: reset de contraseña,
// activación por Admin). Cambiar el email es el único campo de este
// endpoint que es también la credencial de login y el canal de
// recuperación de cuenta — por eso exige `currentPassword` (mismo criterio
// de step-up que `twoFactorStepUpSchema`/`changePasswordSchema`: una sesión
// robada, sola, no puede secuestrar la cuenta cambiándole el correo).
export const updateMeSchema = z
  .object({
    name,
    phone,
    email,
    currentPassword: z.string().min(1, "Current password is required").max(72),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Must include at least one field to update",
  })
  .refine((data) => data.email === undefined || data.currentPassword !== undefined, {
    message: "currentPassword is required to change email",
    path: ["currentPassword"],
  });
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

// AB-01: filtros de GET /api/users. Sin ningún query param la lista sigue
// devolviendo el array completo (compatibilidad con el front actual).
export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: z.enum(["ADMIN", "LENDER", "BORROWER", "BOOKKEEPER", "INSURANCE_COMPANY"]).optional(),
  isActive: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
