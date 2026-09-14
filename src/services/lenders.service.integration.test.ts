import { afterAll, describe, expect, it } from "vitest";
import {
  createTestAdmin,
  createTestBorrower,
  createTestLenderCompany,
  createTestLenderWithoutCompany,
  createTestProperty,
  createTestContract,
  resetPhase1Tables,
} from "@/db/testFixtures";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import * as lendersService from "@/services/lenders.service";

const VALID_COMPANY_INPUT = {
  companyName: "Acme Lending LLC",
  ein: "12-3456789",
  addressLine1: "1 Main St",
  city: "Austin",
  state: "TX",
  postalCode: "78701",
} as const;

describe("lenders.service (BE-041..044, BE-100, D-P4-5: createLenderCompany/createOwnLenderCompany, D-P4-8: updateLenderCompany/deleteLenderCompany)", () => {
  afterAll(resetPhase1Tables);

  it("createLenderCompany le asocia una primera empresa a un Lender auto-registrado sin ninguna", async () => {
    const admin = await createTestAdmin();
    const { lenderProfile } = await createTestLenderWithoutCompany();

    const company = await lendersService.createLenderCompany(lenderProfile.id, VALID_COMPANY_INPUT, admin.id);
    expect(company.companyName).toBe(VALID_COMPANY_INPUT.companyName);

    const detail = await lendersService.getLender(lenderProfile.id);
    expect(detail.lenderCompanies).toHaveLength(1);
    expect(detail.lenderCompanies[0].id).toBe(company.id);
  });

  it("createLenderCompany le agrega una segunda empresa a un Lender que ya tenía una", async () => {
    const admin = await createTestAdmin();
    const { lenderProfile } = await createTestLenderCompany();

    await lendersService.createLenderCompany(lenderProfile.id, { ...VALID_COMPANY_INPUT, ein: "21-2222222" }, admin.id);

    const detail = await lendersService.getLender(lenderProfile.id);
    expect(detail.lenderCompanies).toHaveLength(2);
  });

  it("createLenderCompany con un EIN ya usado responde 409 EIN_TAKEN", async () => {
    const admin = await createTestAdmin();
    const { lenderProfile: profileA } = await createTestLenderWithoutCompany();
    const { lenderProfile: profileB } = await createTestLenderWithoutCompany();
    const ein = "33-3333333";

    await lendersService.createLenderCompany(profileA.id, { ...VALID_COMPANY_INPUT, ein }, admin.id);

    const error = await lendersService.createLenderCompany(profileB.id, { ...VALID_COMPANY_INPUT, ein }, admin.id).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("EIN_TAKEN");
  });

  it("createLenderCompany acepta también el User.id de la persona, no solo el LenderProfile.id (D-P4-7)", async () => {
    const admin = await createTestAdmin();
    const { lenderUser } = await createTestLenderWithoutCompany();

    const company = await lendersService.createLenderCompany(lenderUser.id, { ...VALID_COMPANY_INPUT, ein: "66-6666666" }, admin.id);
    expect(company.companyName).toBe(VALID_COMPANY_INPUT.companyName);
  });

  it("createLenderCompany con un LenderProfile inexistente responde 404 LENDER_NOT_FOUND", async () => {
    const admin = await createTestAdmin();

    const error = await lendersService
      .createLenderCompany("00000000-0000-0000-0000-000000000000", { ...VALID_COMPANY_INPUT, ein: "44-4444444" }, admin.id)
      .catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("LENDER_NOT_FOUND");
  });

  it("createOwnLenderCompany (autoservicio): el propio Lender se crea una empresa", async () => {
    const { lenderUser, lenderProfile } = await createTestLenderWithoutCompany();

    const company = await lendersService.createOwnLenderCompany(lenderUser.id, { ...VALID_COMPANY_INPUT, ein: "55-5555555" });
    expect(company.companyName).toBe(VALID_COMPANY_INPUT.companyName);

    const own = await lendersService.getOwnLenderProfile(lenderUser.id);
    expect(own.lenderCompanies.map((c) => c.id)).toContain(company.id);
    expect(own.id).toBe(lenderProfile.id);
  });

  it("listLenders pagina y busca por nombre de empresa", async () => {
    const marker = `Findable-${Date.now()}`;
    await createTestLenderCompany({ companyName: `${marker} LLC` });

    const result = await lendersService.listLenders({ page: 1, pageSize: 20, search: marker });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].lenderCompanies[0].companyName).toContain(marker);
    expect(result.total).toBe(1);
  });

  it("getLender cuenta borrowers activos y contratos ACTIVE/DELINQUENT de todas sus empresas", async () => {
    const { lenderProfile, lenderUser, lenderCompany } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const contract = await createTestContract({ lenderCompanyId: lenderCompany.id, propertyId: property.id, createdByUserId: lenderUser.id });
    await prisma.contract.update({ where: { id: contract.id }, data: { status: "ACTIVE" } });

    const { borrowerProfile } = await createTestBorrower();
    await prisma.lenderBorrower.create({
      data: { lenderCompanyId: lenderCompany.id, borrowerProfileId: borrowerProfile.id, invitedByUserId: lenderUser.id },
    });

    const detail = await lendersService.getLender(lenderProfile.id);
    expect(detail.borrowersCount).toBe(1);
    expect(detail.activeContractsCount).toBe(1);
  });

  it("updateLenderCompany edita companyName/contactPhone/status/isOpenToDeals de una empresa puntual", async () => {
    const admin = await createTestAdmin();
    const { lenderProfile, lenderCompany } = await createTestLenderCompany();

    const updated = await lendersService.updateLenderCompany(
      lenderProfile.id,
      lenderCompany.id,
      { companyName: "Renombrada LLC", contactPhone: "5512345678", isOpenToDeals: false, status: "SUSPENDED" },
      admin.id,
    );
    expect(updated.companyName).toBe("Renombrada LLC");
    expect(updated.contactPhone).toBe("5512345678");
    expect(updated.isOpenToDeals).toBe(false);
    expect(updated.status).toBe("SUSPENDED");
  });

  it("updateLenderCompany acepta también el User.id del Lender en :id (D-P4-7)", async () => {
    const admin = await createTestAdmin();
    const { lenderUser, lenderCompany } = await createTestLenderCompany();

    const updated = await lendersService.updateLenderCompany(lenderUser.id, lenderCompany.id, { companyName: "Via User Id" }, admin.id);
    expect(updated.companyName).toBe("Via User Id");
  });

  it("updateLenderCompany con un EIN ya usado por otra empresa responde 409 EIN_TAKEN", async () => {
    const admin = await createTestAdmin();
    const { lenderCompany: companyA } = await createTestLenderCompany();
    const { lenderProfile: profileB, lenderCompany: companyB } = await createTestLenderCompany();

    const error = await lendersService.updateLenderCompany(profileB.id, companyB.id, { ein: companyA.ein }, admin.id).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("EIN_TAKEN");
  });

  it("updateLenderCompany con un companyId que no es de ese Lender responde 404 LENDER_COMPANY_NOT_FOUND", async () => {
    const admin = await createTestAdmin();
    const { lenderProfile: profileA } = await createTestLenderCompany();
    const { lenderCompany: companyB } = await createTestLenderCompany();

    const error = await lendersService.updateLenderCompany(profileA.id, companyB.id, { companyName: "x" }, admin.id).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("LENDER_COMPANY_NOT_FOUND");
  });

  it("deleteLenderCompany hace soft-delete de una sola empresa, sin tocar el Lender ni sus otras empresas", async () => {
    const admin = await createTestAdmin();
    const { lenderProfile } = await createTestLenderCompany();
    const secondCompany = await lendersService.createLenderCompany(lenderProfile.id, { ...VALID_COMPANY_INPUT, ein: "77-7777777" }, admin.id);

    await lendersService.deleteLenderCompany(lenderProfile.id, secondCompany.id, admin.id);

    const detail = await lendersService.getLender(lenderProfile.id);
    expect(detail.lenderCompanies.map((c) => c.id)).not.toContain(secondCompany.id);
    expect(detail.lenderCompanies).toHaveLength(1);

    const profile = await prisma.lenderProfile.findUniqueOrThrow({ where: { id: lenderProfile.id } });
    expect(profile.deletedAt).toBeNull();
  });

  it("deleteLenderCompany bloqueado (409) si ESA empresa tiene un contrato ACTIVE/DELINQUENT", async () => {
    const admin = await createTestAdmin();
    const { lenderProfile, lenderUser, lenderCompany } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const contract = await createTestContract({ lenderCompanyId: lenderCompany.id, propertyId: property.id, createdByUserId: lenderUser.id });
    await prisma.contract.update({ where: { id: contract.id }, data: { status: "ACTIVE" } });

    const error = await lendersService.deleteLenderCompany(lenderProfile.id, lenderCompany.id, admin.id).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(409);
    expect((error as AppError).code).toBe("LENDER_HAS_ACTIVE_CONTRACTS");
  });

  it("deleteLender hace soft-delete de User+LenderProfile+LenderCompanies", async () => {
    const admin = await createTestAdmin();
    const { lenderProfile, lenderUser, lenderCompany } = await createTestLenderCompany();

    const result = await lendersService.deleteLender(lenderProfile.id, admin.id);
    expect(result.deletedAt).not.toBeNull();

    const profile = await prisma.lenderProfile.findUniqueOrThrow({ where: { id: lenderProfile.id } });
    const company = await prisma.lenderCompany.findUniqueOrThrow({ where: { id: lenderCompany.id } });
    expect(profile.deletedAt).not.toBeNull();
    expect(company.deletedAt).not.toBeNull();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: lenderUser.id } });
    expect(user.deletedAt).not.toBeNull();
    expect(user.isActive).toBe(false);
  });

  it("deleteLender bloqueado (409) si tiene un contrato ACTIVE/DELINQUENT", async () => {
    const admin = await createTestAdmin();
    const { lenderProfile, lenderUser, lenderCompany } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const contract = await createTestContract({ lenderCompanyId: lenderCompany.id, propertyId: property.id, createdByUserId: lenderUser.id });
    await prisma.contract.update({ where: { id: contract.id }, data: { status: "DELINQUENT" } });

    const error = await lendersService.deleteLender(lenderProfile.id, admin.id).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(409);
    expect((error as AppError).code).toBe("LENDER_HAS_ACTIVE_CONTRACTS");
  });

  it("getOwnLenderProfile (BE-100) opera sobre el LenderProfile del propio usuario", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();

    const own = await lendersService.getOwnLenderProfile(lenderUser.id);
    expect(own.lenderCompanies.map((c) => c.id)).toContain(lenderCompany.id);
  });
});
