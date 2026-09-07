import { activateUserAccount, deactivateUserAccount } from "@/services/userActivation.service";
import { type SafeUser, toSafeUser } from "@/services/users.service";

export interface ActivateResult {
  user: SafeUser;
  emailSent: boolean;
  temporaryPassword?: string;
}

// BE-097 (D-P2-1, riesgo #20 resuelto). Envoltorio delgado sobre
// userActivation.service.ts — la lógica de negocio vive ahí porque
// users.service.ts (PATCH /api/users/:id con isActive, D-P2-4) también la
// necesita y no puede importar de este archivo sin crear un ciclo (este
// archivo ya importa `toSafeUser` de `users.service.ts`).
export async function activateUser(id: string, actorUserId: string): Promise<ActivateResult> {
  const result = await activateUserAccount(id, actorUserId);
  return { user: toSafeUser(result.user), emailSent: result.emailSent, temporaryPassword: result.temporaryPassword };
}

export async function deactivateUser(id: string, actorUserId: string): Promise<SafeUser> {
  const updated = await deactivateUserAccount(id, actorUserId);
  return toSafeUser(updated);
}
