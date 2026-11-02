import { afterAll, describe, expect, it, vi } from "vitest";
import { createTestLenderCompany, createTestProperty, createTestContract, resetPhase1Tables } from "@/db/testFixtures";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import * as emailLib from "@/lib/email";
import * as authService from "@/services/auth.service";
import * as lenderBorrowersService from "@/services/lenderBorrowers.service";

// El Borrower nace abierto (sin vínculo); estos tests lo vinculan como lo haría una cotización aceptada.
async function linkBorrower(borrowerProfileId: string, lenderCompanyId: string, invitedByUserId: string) {
  await prisma.lenderBorrower.create({ data: { lenderCompanyId, borrowerProfileId, invitedByUserId } });
}

describe("lenderBorrowers.service (BE-045..049, D-P4-1)", () => {
  afterAll(resetPhase1Tables);

  it("createBorrower crea un Borrower abierto (sin vínculo a empresas) y nunca devuelve la contraseña", async () => {
    const { lenderUser } = await createTestLenderCompany();
    const email = `create-borrower-${Date.now()}@test.local`;

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const result = await lenderBorrowersService.createBorrower(lenderUser.id, { name: "Nuevo Borrower", email });
    expect(result.emailSent).toBe(true);
    expect(result).not.toHaveProperty("temporaryPassword");
    expect(Object.keys(result.borrower.user).sort()).toEqual(["email", "id", "name", "phone"]); // solo lo que el Lender cargó
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(dbUser.isActive).toBe(true);
    expect(dbUser.mustChangePassword).toBe(true);
    const seen = await lenderBorrowersService.listBorrowers(lenderUser.id, { page: 1, pageSize: 20 });
    expect(seen.items.map((b) => b.id)).toContain(result.borrower.id); // el creador lo ve sin vínculo
    expect(result.borrower.lenderCompanies).toEqual([]);
    expect(await prisma.lenderBorrower.count({ where: { borrowerProfileId: result.borrower.id } })).toBe(0);

    const temporaryPassword = sendEmailSpy.mock.calls[0][0].data.temporaryPassword as string;
    sendEmailSpy.mockRestore();

    const login = await authService.login({ email, password: temporaryPassword });
    expect(login.requiresTwoFactor).toBe(false);
  });

  it("listBorrowers ve deudores de todas las LenderCompany del Lender", async () => {
    const { lenderUser, lenderProfile, lenderCompany: companyA } = await createTestLenderCompany();
    const companyB = await prisma.lenderCompany.create({
      data: {
        lenderProfileId: lenderProfile.id,
        companyName: "Empresa B LLC",
        ein: `ein-b-${Date.now()}`,
        addressLine1: "3 Third St",
        city: "Austin",
        state: "TX",
        postalCode: "78704",
        createdByUserId: lenderUser.id,
      },
    });

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const a = await lenderBorrowersService.createBorrower(lenderUser.id, { name: "Borrower A", email: `borrower-a-${Date.now()}@test.local` });
    const b = await lenderBorrowersService.createBorrower(lenderUser.id, { name: "Borrower B", email: `borrower-b-${Date.now()}@test.local` });
    await linkBorrower(a.borrower.id, companyA.id, lenderUser.id);
    await linkBorrower(b.borrower.id, companyB.id, lenderUser.id);
    sendEmailSpy.mockRestore();

    const result = await lenderBorrowersService.listBorrowers(lenderUser.id, { page: 1, pageSize: 20 });
    expect(result.total).toBe(2);
  });

  it("getBorrowerForLender responde 404 para un deudor que no es del Lender", async () => {
    const { lenderUser } = await createTestLenderCompany();
    const stranger = await createTestLenderCompany();
    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const created = await lenderBorrowersService.createBorrower(stranger.lenderUser.id, {
      name: "No es mío",
      email: `not-mine-${Date.now()}@test.local`,
    });
    await linkBorrower(created.borrower.id, stranger.lenderCompany.id, stranger.lenderUser.id);
    sendEmailSpy.mockRestore();

    const error = await lenderBorrowersService.getBorrowerForLender(lenderUser.id, created.borrower.id).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(404);
  });

  it("updateBorrower edita los campos de contacto del BorrowerProfile", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const created = await lenderBorrowersService.createBorrower(lenderUser.id, {
      name: "A Editar",
      email: `to-edit-${Date.now()}@test.local`,
    });
    await linkBorrower(created.borrower.id, lenderCompany.id, lenderUser.id);
    sendEmailSpy.mockRestore();

    const updated = await lenderBorrowersService.updateBorrower(lenderUser.id, created.borrower.id, { addressLine1: "1 Main St" });
    expect(updated.addressLine1).toBe("1 Main St");
  });

  it("removeBorrower desvincula (removedAt) sin borrar el BorrowerProfile (M-3)", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const created = await lenderBorrowersService.createBorrower(lenderUser.id, {
      name: "A Desvincular",
      email: `to-unlink-${Date.now()}@test.local`,
    });
    await linkBorrower(created.borrower.id, lenderCompany.id, lenderUser.id);
    sendEmailSpy.mockRestore();

    await lenderBorrowersService.removeBorrower(lenderUser.id, created.borrower.id);

    const profile = await prisma.borrowerProfile.findUniqueOrThrow({ where: { id: created.borrower.id } });
    expect(profile.deletedAt).toBeNull();

    const link = await prisma.lenderBorrower.findFirstOrThrow({ where: { borrowerProfileId: created.borrower.id } });
    expect(link.removedAt).not.toBeNull();
    expect(link.status).toBe("REMOVED");

    const error = await lenderBorrowersService.getBorrowerForLender(lenderUser.id, created.borrower.id).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
  });

  it("removeBorrower bloqueado (409) si tiene un contrato ACTIVE/DELINQUENT con esa empresa", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const created = await lenderBorrowersService.createBorrower(lenderUser.id, {
      name: "Con Contrato",
      email: `with-contract-${Date.now()}@test.local`,
    });
    await linkBorrower(created.borrower.id, lenderCompany.id, lenderUser.id);
    sendEmailSpy.mockRestore();

    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const contract = await createTestContract({ lenderCompanyId: lenderCompany.id, propertyId: property.id, createdByUserId: lenderUser.id });
    await prisma.contract.update({ where: { id: contract.id }, data: { status: "ACTIVE" } });
    await prisma.contractBorrower.create({
      data: { contractId: contract.id, borrowerProfileId: created.borrower.id, addedByUserId: lenderUser.id },
    });

    const error = await lenderBorrowersService.removeBorrower(lenderUser.id, created.borrower.id).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(409);
    expect((error as AppError).code).toBe("BORROWER_HAS_ACTIVE_CONTRACTS");
  });
});
