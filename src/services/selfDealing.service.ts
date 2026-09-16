import type { ContractStatus } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";

// D-P7-2 (ver Docs/plan/00-contradicciones-y-decisiones.md). Con el rol dual
// LENDER+BORROWER (D-P7-1) un mismo usuario puede tener, a la vez, una
// LenderCompany propia y un BorrowerProfile propio — sin este chequeo,
// nada le impediría financiarse a sí mismo. Se compara el dueño real
// (User.id) de cada lado, nunca los ids de LenderCompany/BorrowerProfile
// (dos filas distintas pueden pertenecer al mismo usuario).
export async function assertNotSelfLending(lenderCompanyId: string, borrowerProfileIds: string[]): Promise<void> {
  if (borrowerProfileIds.length === 0) return;

  const lenderCompany = await prisma.lenderCompany.findUnique({
    where: { id: lenderCompanyId },
    select: { lenderProfile: { select: { userId: true } } },
  });
  if (!lenderCompany) return; // el caller ya valida que la empresa exista

  const borrowers = await prisma.borrowerProfile.findMany({
    where: { id: { in: borrowerProfileIds } },
    select: { userId: true },
  });

  if (borrowers.some((borrower) => borrower.userId === lenderCompany.lenderProfile.userId)) {
    throw new AppError("You cannot lend to yourself", 409, "SELF_LENDING_NOT_ALLOWED");
  }
}

interface PropertyAddress {
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
}

// D-P7-3. No hay deduplicación real de Property (cada Contract/LoanRequest
// crea una fila nueva, D-S2-25) — "es la misma propiedad" se aproxima por
// dirección normalizada. Limitación conocida y aceptada: un typo o un
// formato distinto ("St" vs "Street") no se detecta.
export function normalizeAddress(address: PropertyAddress): string {
  return [address.addressLine1, address.city, address.state, address.postalCode]
    .map((part) => part.toLowerCase().trim().replace(/\s+/g, " "))
    .join("|");
}

// Contratos donde la propiedad sigue "prestada" — se libera al pagar
// (PAID_OFF) o cancelar (CANCELLED), nunca a mano.
const ENCUMBERING_CONTRACT_STATUSES: ContractStatus[] = ["DRAFT", "PENDING_ACCEPTANCE", "ACTIVE", "DELINQUENT"];

// D-P7-3. Un usuario que pidió dinero como deudor sobre una propiedad no
// puede ofrecer esa misma propiedad actuando como prestamista hasta que el
// préstamo esté pagado — evita financiarse a sí mismo indirectamente contra
// una propiedad que todavía no es enteramente suya. Un LoanRequest sin
// Contract asociado no cuenta: todavía no hay deuda real sobre la propiedad.
export async function assertPropertyNotSelfEncumbered(userId: string, property: PropertyAddress): Promise<void> {
  const borrowerProfile = await prisma.borrowerProfile.findUnique({ where: { userId } });
  if (!borrowerProfile) return;

  const encumberingContracts = await prisma.contract.findMany({
    where: {
      status: { in: ENCUMBERING_CONTRACT_STATUSES },
      deletedAt: null,
      borrowers: { some: { borrowerProfileId: borrowerProfile.id, removedAt: null } },
    },
    select: { property: { select: { addressLine1: true, city: true, state: true, postalCode: true } } },
  });

  const targetAddress = normalizeAddress(property);
  const isSameProperty = encumberingContracts.some((contract) => normalizeAddress(contract.property) === targetAddress);
  if (isSameProperty) {
    throw new AppError("This property is already financed by you as a borrower", 409, "PROPERTY_SELF_ENCUMBERED");
  }
}
