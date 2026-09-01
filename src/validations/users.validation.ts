import { z } from "zod";

// bcrypt ignora silenciosamente todo lo que exceda 72 bytes: se topa acá
// para que un password largo falle en validación y no en un hash truncado.
const password = z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(72);
const name = z.string().trim().min(1, "El nombre es obligatorio").max(120);
const email = z.email("Correo inválido").trim().toLowerCase();

export const createUserSchema = z.object({ name, email, password });
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({ name, email, password })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe incluir al menos un campo para actualizar",
  });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
