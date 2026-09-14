import { UserRole } from "@prisma/client";
import { z } from "zod";

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
// BE-008: el rol es obligatorio y explícito en cada alta, sin default — ver
// Docs/plan/04-base-de-datos.md §4.3 (User). Los flujos de alta específicos
// por rol (Admin crea Lender, Lender crea Borrower, etc.) llegan en fases
// posteriores; este endpoint genérico de Fase 0 solo exige que se declare.
const role = z.enum(UserRole);
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

// Autoservicio (`PATCH /api/auth/me`): un usuario solo puede tocar sus
// propios datos de contacto — nunca `email`/`password`/`role`/`isActive`
// desde acá (esos tienen flujos propios con sus propias reglas de
// seguridad: cambio de correo, reset de contraseña, activación por Admin).
export const updateMeSchema = z
  .object({ name, phone })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Must include at least one field to update",
  });
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
