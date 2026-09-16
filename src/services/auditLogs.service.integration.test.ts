import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/prisma";
import { createTestLenderCompany, createTestLenderWithoutCompany, resetPhase1Tables } from "@/db/testFixtures";
import { AppError } from "@/errors/AppError";
import * as auditLogsService from "@/services/auditLogs.service";

function query(overrides: Partial<{ page: number; pageSize: number; contractId: string; action: string; entityType: string }> = {}) {
  return { page: 1, pageSize: 20, ...overrides };
}

// BE-072 — sin cobertura propia hasta ahora (solo se ejercitaba de paso en
// payments-routes.integration.test.ts, sin probar el aislamiento por
// LenderCompany). El criterio tenant-scoped es el mismo que el resto del
// backend desde que se descartó `withTenantScope` (D-P6-1): un LENDER solo
// ve auditoría de sus propias LenderCompany, nunca de otras.
describe("auditLogs.service (BE-072)", () => {
  afterAll(resetPhase1Tables);

  it("un ADMIN ve auditoría de cualquier LenderCompany", async () => {
    const a = await createTestLenderCompany();
    const b = await createTestLenderCompany();
    await prisma.auditLog.createMany({
      data: [
        { action: "CONTRACT_CREATED", entityType: "Contract", lenderCompanyId: a.lenderCompany.id },
        { action: "CONTRACT_CREATED", entityType: "Contract", lenderCompanyId: b.lenderCompany.id },
      ],
    });

    const result = await auditLogsService.listAuditLogs({ userId: "00000000-0000-0000-0000-000000000000", role: "ADMIN" }, query());
    expect(result.total).toBeGreaterThanOrEqual(2);
    const companyIds = result.items.map((item) => item.lenderCompanyId);
    expect(companyIds).toContain(a.lenderCompany.id);
    expect(companyIds).toContain(b.lenderCompany.id);
  });

  it("un LENDER solo ve auditoría de sus propias LenderCompany, nunca de otras", async () => {
    const owner = await createTestLenderCompany();
    const stranger = await createTestLenderCompany();
    await prisma.auditLog.createMany({
      data: [
        { action: "CONTRACT_CREATED", entityType: "Contract", lenderCompanyId: owner.lenderCompany.id },
        { action: "CONTRACT_CANCELLED", entityType: "Contract", lenderCompanyId: stranger.lenderCompany.id },
      ],
    });

    const result = await auditLogsService.listAuditLogs({ userId: owner.lenderUser.id, role: "LENDER" }, query());
    expect(result.items.every((item) => item.lenderCompanyId === owner.lenderCompany.id)).toBe(true);
    expect(result.items.map((item) => item.lenderCompanyId)).not.toContain(stranger.lenderCompany.id);
  });

  it("un LENDER sin ninguna LenderCompany recibe una página vacía, no un error", async () => {
    const { lenderUser } = await createTestLenderWithoutCompany();
    const result = await auditLogsService.listAuditLogs({ userId: lenderUser.id, role: "LENDER" }, query());
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("un BORROWER no tiene acceso (403 FORBIDDEN)", async () => {
    const error = await auditLogsService
      .listAuditLogs({ userId: "00000000-0000-0000-0000-000000000000", role: "BORROWER" }, query())
      .catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(403);
    expect((error as AppError).code).toBe("FORBIDDEN");
  });

  it("filtra por action y entityType dentro del alcance del propio tenant", async () => {
    const owner = await createTestLenderCompany();
    await prisma.auditLog.createMany({
      data: [
        { action: "CONTRACT_CREATED", entityType: "Contract", lenderCompanyId: owner.lenderCompany.id },
        { action: "CONTRACT_CANCELLED", entityType: "Contract", lenderCompanyId: owner.lenderCompany.id },
        { action: "CONTRACT_CANCELLED", entityType: "ContractTerms", lenderCompanyId: owner.lenderCompany.id },
      ],
    });

    const byAction = await auditLogsService.listAuditLogs({ userId: owner.lenderUser.id, role: "LENDER" }, query({ action: "CONTRACT_CANCELLED" }));
    expect(byAction.items.every((item) => item.action === "CONTRACT_CANCELLED")).toBe(true);
    expect(byAction.total).toBe(2);

    const byBoth = await auditLogsService.listAuditLogs(
      { userId: owner.lenderUser.id, role: "LENDER" },
      query({ action: "CONTRACT_CANCELLED", entityType: "ContractTerms" }),
    );
    expect(byBoth.total).toBe(1);
  });

  it("pagina correctamente (page/pageSize/totalPages)", async () => {
    const owner = await createTestLenderCompany();
    await prisma.auditLog.createMany({
      data: Array.from({ length: 5 }, () => ({ action: "CONTRACT_CREATED", entityType: "Contract", lenderCompanyId: owner.lenderCompany.id })),
    });

    const firstPage = await auditLogsService.listAuditLogs({ userId: owner.lenderUser.id, role: "LENDER" }, query({ pageSize: 2 }));
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.total).toBe(5);
    expect(firstPage.totalPages).toBe(3);

    const secondPage = await auditLogsService.listAuditLogs({ userId: owner.lenderUser.id, role: "LENDER" }, query({ page: 2, pageSize: 2 }));
    expect(secondPage.items).toHaveLength(2);
    expect(secondPage.items.map((item) => item.id)).not.toEqual(firstPage.items.map((item) => item.id));
  });
});
