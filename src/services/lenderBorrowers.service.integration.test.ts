import { afterAll, describe, expect, it, vi } from "vitest";
import { createTestLenderCompany, createTestProperty, createTestContract, resetPhase1Tables } from "@/db/testFixtures";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import * as emailLib from "@/lib/email";
import * as authService from "@/services/auth.service";
import * as lenderBorrowersService from "@/services/lenderBorrowers.service";

describe("lenderBorrowers.service (BE-045..049, D-P4-1)", () => {
  afterAll(resetPhase1Tables);

  it("createBorrower con una sola LenderCompany la resuelve sin pedir lenderCompanyId, y nunca devuelve la contraseña", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const email = `create-borrower-${Date.now()}@test.local`;

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const result = await lenderBorrowersService.createBorrower(lenderUser.id, { name: "Nuevo Borrower", email });
    expect(result.emailSent).toBe(true);
    expect(result).not.toHaveProperty("temporaryPassword");
    expect(result.borrower.user.isActive).toBe(true);
    expect(result.borrower.user.mustChangePassword).toBe(true);
    expect(result.borrower.lenderCompanies.map((c) => c.id)).toEqual([lenderCompany.id]);

    const temporaryPassword = sendEmailSpy.mock.calls[0][0].data.temporaryPassword as string;
    sendEmailSpy.mockRestore();

    const login = await authService.login({ email, password: temporaryPassword });
    expect(login.requiresTwoFactor).toBe(false);
  });

  it("createBorrower con más de una LenderCompany exige lenderCompanyId, y un valor ajeno responde 404 (nunca se usa)", async () => {
    const { lenderUser, lenderProfile } = await createTestLenderCompany();
    const secondCompany = await prisma.lenderCompany.create({
      data: {
        lenderProfileId: lenderProfile.id,
        companyName: "Segunda Empresa LLC",
        ein: `ein-second-${Date.now()}`,
        addressLine1: "2 Second St",
        city: "Austin",
        state: "TX",
        postalCode: "78703",
        createdByUserId: lenderUser.id,
      },
    });

    const withoutCompanyId = await lenderBorrowersService
      .createBorrower(lenderUser.id, { name: "Sin Empresa", email: `no-company-${Date.now()}@test.local` })
      .catch((e) => e);
    expect(withoutCompanyId).toBeInstanceOf(AppError);
    expect((withoutCompanyId as AppError).code).toBe("LENDER_COMPANY_REQUIRED");

    const otherLenderCompany = await createTestLenderCompany();
    const foreignAttempt = await lenderBorrowersService
      .createBorrower(lenderUser.id, {
        name: "Empresa Ajena",
        email: `foreign-company-${Date.now()}@test.local`,
        lenderCompanyId: otherLenderCompany.lenderCompany.id,
      })
      .catch((e) => e);
    expect(foreignAttempt).toBeInstanceOf(AppError);
    expect((foreignAttempt as AppError).statusCode).toBe(404);

    const result = await lenderBorrowersService.createBorrower(lenderUser.id, {
      name: "Con Empresa",
      email: `with-company-${Date.now()}@test.local`,
      lenderCompanyId: secondCompany.id,
    });
    expect(result.borrower.lenderCompanies.map((c) => c.id)).toEqual([secondCompany.id]);
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
    await lenderBorrowersService.createBorrower(lenderUser.id, {
      name: "Borrower A",
      email: `borrower-a-${Date.now()}@test.local`,
      lenderCompanyId: companyA.id,
    });
    await lenderBorrowersService.createBorrower(lenderUser.id, {
      name: "Borrower B",
      email: `borrower-b-${Date.now()}@test.local`,
      lenderCompanyId: companyB.id,
    });
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
    sendEmailSpy.mockRestore();

    const error = await lenderBorrowersService.getBorrowerForLender(lenderUser.id, created.borrower.id).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(404);
  });

  it("updateBorrower edita los campos de contacto del BorrowerProfile", async () => {
    const { lenderUser } = await createTestLenderCompany();
    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const created = await lenderBorrowersService.createBorrower(lenderUser.id, {
      name: "A Editar",
      email: `to-edit-${Date.now()}@test.local`,
    });
    sendEmailSpy.mockRestore();

    const updated = await lenderBorrowersService.updateBorrower(lenderUser.id, created.borrower.id, { phone: "5512345678" });
    expect(updated.phone).toBe("5512345678");
  });

  it("removeBorrower desvincula (removedAt) sin borrar el BorrowerProfile (M-3)", async () => {
    const { lenderUser } = await createTestLenderCompany();
    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const created = await lenderBorrowersService.createBorrower(lenderUser.id, {
      name: "A Desvincular",
      email: `to-unlink-${Date.now()}@test.local`,
    });
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
