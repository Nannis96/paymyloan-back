import { Prisma, type Contract, type ContractStatus, type ReviewDirection } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { requireContractAccess } from "@/middlewares/requireContractAccess";
import type { Session } from "@/middlewares/withAuth";
import { buildPaginatedResult, type PaginatedResult, type PaginationQuery } from "@/validations/pagination";
import type { CreateReviewInput } from "@/validations/reviews.validation";

// Fase 18 (PB-031..034). Ratings Lender <-> Borrower — ver
// Docs/plan/fases/fase-18-ratings-lender-borrower.md. Reseña de solo
// inserción; promedios siempre derivados, nunca guardados (D-S2-11/D-S2-13).

// R2: hubo trato real. Sin DRAFT/PENDING_ACCEPTANCE/CANCELLED — la relación
// no llegó a existir.
const REVIEWABLE_STATUSES: ContractStatus[] = ["ACTIVE", "DELINQUENT", "PAID_OFF"];

const publicReviewSelect = { id: true, rating: true, comment: true, createdAt: true } satisfies Prisma.ReviewSelect;

interface ReviewContext {
  direction: ReviewDirection;
  // Co-deudores que este usuario todavía puede calificar en este contrato.
  // Lender: los co-deudores activos sin reseña. Borrower: él mismo si no reseñó.
  pendingBorrowerProfileIds: string[];
  activeBorrowerProfileIds: string[];
}

// Único lugar que hay que tocar si la regla de elegibilidad cambia (mismo
// criterio que messaging.service.ts#canMessage). El sentido se infiere del
// lado en que el usuario está EN ESE CONTRATO, no de User.role: un usuario
// dual (D-P7-1) es Lender en un contrato y Borrower en otro. Devuelve null si
// no es parte del contrato. Ser ambas partes a la vez es autocalificación
// (D-P7-2 lo impide al crear el contrato, esto es el cinturón).
async function reviewContext(userId: string, contract: Contract): Promise<ReviewContext | null> {
  const [ownsCompany, ownLink, activeBorrowers, reviewed] = await Promise.all([
    prisma.lenderCompany.findFirst({
      where: { id: contract.lenderCompanyId, lenderProfile: { userId } },
      select: { id: true },
    }),
    prisma.contractBorrower.findFirst({
      where: { contractId: contract.id, removedAt: null, borrowerProfile: { userId, deletedAt: null } },
      select: { borrowerProfileId: true },
    }),
    prisma.contractBorrower.findMany({
      where: { contractId: contract.id, removedAt: null },
      select: { borrowerProfileId: true },
    }),
    prisma.review.findMany({
      where: { contractId: contract.id },
      select: { borrowerProfileId: true, direction: true },
    }),
  ]);

  if (ownsCompany && ownLink) {
    throw new AppError("You cannot review yourself", 409, "SELF_REVIEW_NOT_ALLOWED");
  }
  const activeBorrowerProfileIds = activeBorrowers.map((row) => row.borrowerProfileId);

  if (ownsCompany) {
    const done = new Set(reviewed.filter((r) => r.direction === "LENDER_TO_BORROWER").map((r) => r.borrowerProfileId));
    return {
      direction: "LENDER_TO_BORROWER",
      activeBorrowerProfileIds,
      pendingBorrowerProfileIds: activeBorrowerProfileIds.filter((id) => !done.has(id)),
    };
  }
  if (ownLink) {
    const already = reviewed.some((r) => r.direction === "BORROWER_TO_LENDER" && r.borrowerProfileId === ownLink.borrowerProfileId);
    return {
      direction: "BORROWER_TO_LENDER",
      activeBorrowerProfileIds,
      pendingBorrowerProfileIds: already ? [] : [ownLink.borrowerProfileId],
    };
  }
  return null;
}

// PB-032.
export async function createReview(session: Session, contractId: string, input: CreateReviewInput) {
  const contract = await requireContractAccess(session, contractId);
  const context = await reviewContext(session.userId, contract);
  if (!context) {
    throw new AppError("Contract not found", 404, "NOT_FOUND");
  }
  if (!REVIEWABLE_STATUSES.includes(contract.status)) {
    throw new AppError("This contract cannot be reviewed yet", 403, "REVIEW_NOT_ALLOWED");
  }

  let borrowerProfileId: string;
  if (context.direction === "LENDER_TO_BORROWER") {
    if (!input.borrowerProfileId) {
      throw new AppError("borrowerProfileId is required when the lender reviews", 400, "BORROWER_PROFILE_REQUIRED");
    }
    if (!context.activeBorrowerProfileIds.includes(input.borrowerProfileId)) {
      throw new AppError("Borrower not found on this contract", 404, "NOT_FOUND");
    }
    borrowerProfileId = input.borrowerProfileId;
  } else {
    // Borrower: el calificado es la LenderCompany del contrato; su propio
    // perfil viene de la asociación, nunca del body.
    borrowerProfileId = await requireOwnActiveProfileId(session.userId, contract.id);
  }

  try {
    return await prisma.review.create({
      data: {
        contractId: contract.id,
        lenderCompanyId: contract.lenderCompanyId,
        borrowerProfileId,
        direction: context.direction,
        reviewerUserId: session.userId,
        rating: input.rating,
        comment: input.comment ?? null,
      },
    });
  } catch (error) {
    // @@unique([contractId, borrowerProfileId, direction]) — cubre también la
    // carrera de dos envíos simultáneos.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("You already reviewed this on this contract", 409, "REVIEW_ALREADY_EXISTS");
    }
    throw error;
  }
}

async function requireOwnActiveProfileId(userId: string, contractId: string): Promise<string> {
  const link = await prisma.contractBorrower.findFirstOrThrow({
    where: { contractId, removedAt: null, borrowerProfile: { userId } },
    select: { borrowerProfileId: true },
  });
  return link.borrowerProfileId;
}

// PB-032. Las reseñas del contrato (las dos direcciones) más lo que el
// usuario actual todavía puede hacer, para que el front sepa si mostrar el
// botón. Admin (lectura) no es parte: `canReview` siempre false.
export async function listContractReviews(session: Session, contractId: string) {
  const contract = await requireContractAccess(session, contractId);
  const [reviews, context] = await Promise.all([
    prisma.review.findMany({
      where: { contractId },
      orderBy: { createdAt: "asc" },
      select: { ...publicReviewSelect, direction: true, borrowerProfileId: true },
    }),
    reviewContext(session.userId, contract).catch(() => null),
  ]);
  const pendingBorrowerProfileIds = context && REVIEWABLE_STATUSES.includes(contract.status) ? context.pendingBorrowerProfileIds : [];
  return { reviews, canReview: pendingBorrowerProfileIds.length > 0, pendingBorrowerProfileIds };
}

interface RatingSummary {
  average: number | null;
  count: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
}

// AVG derivado de un groupBy — una sola query agregada e indexada.
// ponytail: se recalcula en cada request; si un listado del marketplace lo
// vuelve lento, cachear en columna y refrescar al insertar una Review.
async function summarize(where: Prisma.ReviewWhereInput): Promise<RatingSummary> {
  const groups = await prisma.review.groupBy({ by: ["rating"], where, _count: { _all: true } });
  const distribution = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  let count = 0;
  let sum = 0;
  for (const group of groups) {
    distribution[String(group.rating) as keyof typeof distribution] = group._count._all;
    count += group._count._all;
    sum += group.rating * group._count._all;
  }
  return { average: count ? Math.round((sum / count) * 100) / 100 : null, count, distribution };
}

async function pagedReviews(where: Prisma.ReviewWhereInput, query: PaginationQuery): Promise<PaginatedResult<Prisma.ReviewGetPayload<{ select: typeof publicReviewSelect }>>> {
  const [items, total] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: publicReviewSelect,
    }),
    prisma.review.count({ where }),
  ]);
  return buildPaginatedResult(items, total, query);
}

// PB-033. R5: los comentarios sobre una LenderCompany son públicos para
// cualquier usuario autenticado (es un marketplace: el Deudor elige con
// quién trabajar). No se expone quién reseñó.
export async function getLenderRating(lenderCompanyId: string, query: PaginationQuery) {
  const company = await prisma.lenderCompany.findFirst({ where: { id: lenderCompanyId, deletedAt: null }, select: { id: true } });
  if (!company) {
    throw new AppError("Lender company not found", 404, "NOT_FOUND");
  }
  const where = { lenderCompanyId, direction: "BORROWER_TO_LENDER" } satisfies Prisma.ReviewWhereInput;
  const [summary, reviews] = await Promise.all([summarize(where), pagedReviews(where, query)]);
  return { ...summary, reviews };
}

// PB-033. R5: promedio+conteo visible para cualquier Lender, Admin y el propio
// Borrower (persona física — otro Borrower recibe 404). Los comentarios solo
// los ve el propio Borrower, Admin y un Lender que tuvo/tiene contrato con él;
// para el resto `reviews` viaja null. Mismo path que PB-009: cuando exista el
// score calculado se le agrega un campo sin romper este contrato.
export async function getBorrowerRating(session: Session, borrowerProfileId: string, query: PaginationQuery) {
  const profile = await prisma.borrowerProfile.findFirst({ where: { id: borrowerProfileId, deletedAt: null }, select: { userId: true } });
  const isAdmin = session.roles.includes("ADMIN");
  const isLender = session.roles.includes("LENDER");
  const isSelf = profile?.userId === session.userId;
  if (!profile || !(isAdmin || isLender || isSelf)) {
    throw new AppError("Borrower not found", 404, "NOT_FOUND");
  }

  const hasContractWithThem =
    !isAdmin && !isSelf
      ? (await prisma.contract.findFirst({
          where: { deletedAt: null, lenderCompany: { lenderProfile: { userId: session.userId } }, borrowers: { some: { borrowerProfileId } } },
          select: { id: true },
        })) !== null
      : false;
  const commentsVisible = isAdmin || isSelf || hasContractWithThem;

  const where = { borrowerProfileId, direction: "LENDER_TO_BORROWER" } satisfies Prisma.ReviewWhereInput;
  const [summary, reviews] = await Promise.all([summarize(where), commentsVisible ? pagedReviews(where, query) : Promise.resolve(null)]);
  return { ...summary, reviews };
}

// PB-034. Contratos elegibles donde el usuario todavía no reseñó — lo que
// hace que la gente efectivamente califique. Ambos lados en una lista.
// ponytail: tope 100 por lado sin paginar; paginar si alguien acumula más.
export async function listPendingReviews(userId: string) {
  const [asLender, asBorrower] = await Promise.all([
    prisma.contract.findMany({
      where: { deletedAt: null, status: { in: REVIEWABLE_STATUSES }, lenderCompany: { lenderProfile: { userId } } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        contractNumber: true,
        lenderCompanyId: true,
        borrowers: { where: { removedAt: null }, select: { borrowerProfile: { select: { id: true, user: { select: { name: true } } } } } },
        reviews: { where: { direction: "LENDER_TO_BORROWER" }, select: { borrowerProfileId: true } },
      },
    }),
    prisma.contract.findMany({
      where: {
        deletedAt: null,
        status: { in: REVIEWABLE_STATUSES },
        borrowers: { some: { removedAt: null, borrowerProfile: { userId } } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        contractNumber: true,
        lenderCompany: { select: { id: true, companyName: true } },
        borrowers: { where: { removedAt: null, borrowerProfile: { userId } }, select: { borrowerProfileId: true } },
        reviews: { where: { direction: "BORROWER_TO_LENDER", borrowerProfile: { userId } }, select: { id: true } },
      },
    }),
  ]);

  const lenderItems = asLender.flatMap((contract) => {
    const done = new Set(contract.reviews.map((r) => r.borrowerProfileId));
    return contract.borrowers
      .filter((b) => !done.has(b.borrowerProfile.id))
      .map((b) => ({
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        direction: "LENDER_TO_BORROWER" as const,
        lenderCompanyId: contract.lenderCompanyId,
        borrowerProfileId: b.borrowerProfile.id,
        counterpartName: b.borrowerProfile.user.name,
      }));
  });

  const borrowerItems = asBorrower
    .filter((contract) => contract.reviews.length === 0 && contract.borrowers.length > 0)
    .map((contract) => ({
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      direction: "BORROWER_TO_LENDER" as const,
      lenderCompanyId: contract.lenderCompany.id,
      borrowerProfileId: contract.borrowers[0].borrowerProfileId,
      counterpartName: contract.lenderCompany.companyName,
    }));

  return [...lenderItems, ...borrowerItems];
}
