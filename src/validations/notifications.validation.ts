import { z } from "zod";
import { paginationQuerySchema } from "@/validations/pagination";

// Fase 19 (PB-036). `isRead` llega como string en el query string.
export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  isRead: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  type: z.string().trim().min(1).max(50).optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
