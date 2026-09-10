import { z } from "zod";

// Compartida por los primeros endpoints con lista+búsqueda+paginación de
// este backend (BE-041, BE-046). Query string → números coercionados vía
// `z.coerce` (todo query param llega como string).
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function buildPaginatedResult<T>(items: T[], total: number, query: Pick<PaginationQuery, "page" | "pageSize">): PaginatedResult<T> {
  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}
