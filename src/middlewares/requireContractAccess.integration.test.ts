import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/prisma";
import { createTestBorrower, createTestLenderCompany, createTestProperty, createTestContract, resetPhase1Tables } from "@/db/testFixtures";
import { AppError } from "@/errors/AppError";
import { requireContractAccess } from "@/middlewares/requireContractAccess";

// BE-038 (los 4 casos que pide el ticket) + BE-039 (auditoría de accesos
// denegados) — sin ningún endpoint de contratos todavía (Fase 6), probado
// directo contra las fixtures de Fase 1.
describe("requireContractAccess (BE-038/BE-039)", () => {
  afterAll(resetPhase1Tables);

  it("el LENDER dueño de la LenderCompany accede a su contrato", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const contract = await createTestContract({ lenderCompanyId: lenderCompany.id, propertyId: property.id, createdByUserId: lenderUser.id });

    const result = await requireContractAccess({ userId: lenderUser.id, role: "LENDER", roles: ["LENDER"] }, contract.id);
    expect(result.id).toBe(contract.id);
  });

  it("un LENDER ajeno (otra LenderCompany) recibe 404 y queda auditado como ACCESS_DENIED", async () => {
    const owner = await createTestLenderCompany();
    const property = await createTestProperty(owner.lenderCompany.id, owner.lenderUser.id);
    const contract = await createTestContract({
      lenderCompanyId: owner.lenderCompany.id,
      propertyId: property.id,
      createdByUserId: owner.lenderUser.id,
    });

    const stranger = await createTestLenderCompany();

    const error = await requireContractAccess({ userId: stranger.lenderUser.id, role: "LENDER", roles: ["LENDER"] }, contract.id).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(404);
    expect((error as AppError).code).toBe("NOT_FOUND");

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: "ACCESS_DENIED", actorUserId: stranger.lenderUser.id, contractId: contract.id },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.lenderCompanyId).toBe(owner.lenderCompany.id);
  });

  it("un BORROWER asociado (ContractBorrower activo) accede al contrato", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const contract = await createTestContract({ lenderCompanyId: lenderCompany.id, propertyId: property.id, createdByUserId: lenderUser.id });

    const { user: borrowerUser, borrowerProfile } = await createTestBorrower();
    await prisma.contractBorrower.create({
      data: { contractId: contract.id, borrowerProfileId: borrowerProfile.id, addedByUserId: lenderUser.id },
    });

    const result = await requireContractAccess({ userId: borrowerUser.id, role: "BORROWER", roles: ["BORROWER"] }, contract.id);
    expect(result.id).toBe(contract.id);
  });

  it("un BORROWER no asociado recibe 404 y queda auditado como ACCESS_DENIED", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const contract = await createTestContract({ lenderCompanyId: lenderCompany.id, propertyId: property.id, createdByUserId: lenderUser.id });

    const { user: strangerBorrower } = await createTestBorrower();

    const error = await requireContractAccess({ userId: strangerBorrower.id, role: "BORROWER", roles: ["BORROWER"] }, contract.id).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(404);
    expect((error as AppError).code).toBe("NOT_FOUND");

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: "ACCESS_DENIED", actorUserId: strangerBorrower.id, contractId: contract.id },
    });
    expect(auditRow).not.toBeNull();
  });

  it("un contrato inexistente responde 404 sin distinguirlo de un tenant mismatch", async () => {
    const error = await requireContractAccess(
      { userId: "00000000-0000-0000-0000-000000000000", role: "LENDER", roles: ["LENDER"] },
      "00000000-0000-0000-0000-000000000001",
    ).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(404);
  });

  // Fase 7 (pedido explícito de Spencer): el Admin ve/edita cualquier
  // contrato, sin restricción de tenant — a diferencia de LENDER/BORROWER,
  // no necesita "ser dueño" de nada.
  it("ADMIN accede a cualquier contrato, sin restricción de tenant", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const contract = await createTestContract({ lenderCompanyId: lenderCompany.id, propertyId: property.id, createdByUserId: lenderUser.id });

    const result = await requireContractAccess({ userId: "00000000-0000-0000-0000-000000000000", role: "ADMIN", roles: ["ADMIN"] }, contract.id);
    expect(result.id).toBe(contract.id);
  });

  it("un rol distinto de LENDER/BORROWER/ADMIN (p.ej. BOOKKEEPER) responde 403 FORBIDDEN", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const contract = await createTestContract({ lenderCompanyId: lenderCompany.id, propertyId: property.id, createdByUserId: lenderUser.id });

    const error = await requireContractAccess(
      { userId: "00000000-0000-0000-0000-000000000000", role: "BOOKKEEPER", roles: ["BOOKKEEPER"] },
      contract.id,
    ).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(403);
    expect((error as AppError).code).toBe("FORBIDDEN");
  });

  // D-P7-1: el caso que el rol dual vuelve posible por primera vez — antes
  // era imposible que `session.roles` tuviera los dos a la vez.
  it("D-P7-1: un usuario dual accede como BORROWER a un contrato aunque también tenga LENDER en `roles`", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const contract = await createTestContract({ lenderCompanyId: lenderCompany.id, propertyId: property.id, createdByUserId: lenderUser.id });

    const { user: borrowerUser, borrowerProfile } = await createTestBorrower();
    await prisma.contractBorrower.create({
      data: { contractId: contract.id, borrowerProfileId: borrowerProfile.id, addedByUserId: lenderUser.id },
    });

    const result = await requireContractAccess({ userId: borrowerUser.id, role: "BORROWER", roles: ["BORROWER", "LENDER"] }, contract.id);
    expect(result.id).toBe(contract.id);
  });

  it("D-P7-1: un usuario dual accede como LENDER a su contrato aunque también tenga BORROWER en `roles`", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const contract = await createTestContract({ lenderCompanyId: lenderCompany.id, propertyId: property.id, createdByUserId: lenderUser.id });

    const result = await requireContractAccess({ userId: lenderUser.id, role: "LENDER", roles: ["BORROWER", "LENDER"] }, contract.id);
    expect(result.id).toBe(contract.id);
  });

  it("D-P7-1: un usuario dual sigue sin poder acceder a un contrato completamente ajeno", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const contract = await createTestContract({ lenderCompanyId: lenderCompany.id, propertyId: property.id, createdByUserId: lenderUser.id });

    const stranger = await createTestLenderCompany();
    const { user: strangerBorrower } = await createTestBorrower();

    const error = await requireContractAccess(
      { userId: stranger.lenderUser.id, role: "LENDER", roles: ["BORROWER", "LENDER"] },
      contract.id,
    ).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(404);

    const error2 = await requireContractAccess(
      { userId: strangerBorrower.id, role: "BORROWER", roles: ["BORROWER", "LENDER"] },
      contract.id,
    ).catch((e) => e);
    expect(error2).toBeInstanceOf(AppError);
    expect((error2 as AppError).statusCode).toBe(404);
  });
});
