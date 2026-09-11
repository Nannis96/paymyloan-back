import type { ContractFeeItem } from "@prisma/client";
import type { Session } from "@/middlewares/withAuth";
import { requireContractAccess } from "@/middlewares/requireContractAccess";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";
import type { CreateFeeItemInput } from "@/validations/contracts.validation";

// PB-020 (D-S2-2). Closing Fee Summary Table — de solo inserción/borrado
// (nunca edición), atada a una versión concreta de ContractTerms.
async function requireContractTerms(contractId: string, termsId: string) {
  const terms = await prisma.contractTerms.findUnique({ where: { id: termsId } });
  if (!terms || terms.contractId !== contractId) {
    throw new AppError("Contract terms not found", 404, "NOT_FOUND");
  }
  return terms;
}

export async function listFees(session: Session, contractId: string, termsId: string): Promise<ContractFeeItem[]> {
  await requireContractAccess(session, contractId);
  await requireContractTerms(contractId, termsId);
  return prisma.contractFeeItem.findMany({ where: { contractTermsId: termsId }, orderBy: { createdAt: "asc" } });
}

// D-S2-5/D-S2-19: `code=MARKETPLACE_CONNECTION` está reservado — solo el
// propio servicio la inserta automáticamente (Fase 13, cuando
// `Contract.originationSource` exista), nunca este endpoint manual.
export async function addFee(userId: string, contractId: string, termsId: string, input: CreateFeeItemInput): Promise<ContractFeeItem> {
  const contract = await requireContractAccess({ userId, role: "LENDER" }, contractId);
  const terms = await requireContractTerms(contractId, termsId);
  if (terms.status !== "DRAFT") {
    throw new AppError("Fees can only be edited while the terms version is DRAFT", 409, "TERMS_NOT_EDITABLE");
  }
  if (input.code === "MARKETPLACE_CONNECTION") {
    throw new AppError("MARKETPLACE_CONNECTION is inserted automatically, not created manually", 400, "RESERVED_FEE_CODE");
  }

  const computedAmount =
    input.amountType === "FLAT" ? input.amountValue : terms.principalAmount.times(input.amountValue).div(100);

  const fee = await prisma.contractFeeItem.create({
    data: {
      contractTermsId: termsId,
      category: input.category,
      code: input.code,
      label: input.label ?? input.code,
      amountType: input.amountType,
      amountValue: input.amountValue,
      computedAmount,
    },
  });

  await logAuditEvent({
    action: "CONTRACT_FEE_ITEM_ADDED",
    entityType: "ContractFeeItem",
    entityId: fee.id,
    actorUserId: userId,
    lenderCompanyId: contract.lenderCompanyId,
    contractId,
  });

  return fee;
}

export async function deleteFee(userId: string, contractId: string, termsId: string, feeId: string): Promise<void> {
  const contract = await requireContractAccess({ userId, role: "LENDER" }, contractId);
  const terms = await requireContractTerms(contractId, termsId);
  if (terms.status !== "DRAFT") {
    throw new AppError("Fees can only be edited while the terms version is DRAFT", 409, "TERMS_NOT_EDITABLE");
  }

  const fee = await prisma.contractFeeItem.findUnique({ where: { id: feeId } });
  if (!fee || fee.contractTermsId !== termsId) {
    throw new AppError("Fee not found", 404, "NOT_FOUND");
  }

  await prisma.contractFeeItem.delete({ where: { id: feeId } });
  await logAuditEvent({
    action: "CONTRACT_FEE_ITEM_REMOVED",
    entityType: "ContractFeeItem",
    entityId: feeId,
    actorUserId: userId,
    lenderCompanyId: contract.lenderCompanyId,
    contractId,
  });
}
