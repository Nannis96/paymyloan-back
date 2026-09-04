import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/prisma";
import {
  createTestAdmin,
  createTestBorrower,
  createTestLenderCompany,
  createTestUser,
  resetPhase1Tables,
} from "@/db/testFixtures";

// BE-008, BE-009, BE-090, BE-010, BE-091, BE-092, BE-093, BE-094 — ver
// Docs/plan/16-fase-1-actualizada.md.
describe("Fase 1 — identidad y tenancy", () => {
  afterAll(resetPhase1Tables);

  it("User.role es obligatorio y User.isActive nace en true (BE-008, D-P1-2)", async () => {
    const user = await createTestUser("ADMIN");
    expect(user.role).toBe("ADMIN");
    expect(user.isActive).toBe(true);
    expect(user.deletedAt).toBeNull();
  });

  it("acepta los 5 valores de UserRole, incluyendo los nuevos del Product Board (D-P1-1)", async () => {
    const roles = ["ADMIN", "LENDER", "BORROWER", "BOOKKEEPER", "INSURANCE_COMPANY"] as const;
    for (const role of roles) {
      const user = await createTestUser(role);
      expect(user.role).toBe(role);
    }
  });

  it("LenderProfile es 1:1 con User — un segundo perfil para el mismo userId falla (BE-009)", async () => {
    const admin = await createTestAdmin();
    const lender = await createTestUser("LENDER");
    await prisma.lenderProfile.create({ data: { userId: lender.id, createdByAdminId: admin.id } });

    await expect(
      prisma.lenderProfile.create({ data: { userId: lender.id, createdByAdminId: admin.id } }),
    ).rejects.toThrow();
  });

  it("LenderProfile.createdByAdminId es nulo cuando el Prestamista se auto-registra (D-P1-10)", async () => {
    const lender = await createTestUser("LENDER");
    const profile = await prisma.lenderProfile.create({ data: { userId: lender.id, createdByAdminId: null } });
    expect(profile.createdByAdminId).toBeNull();
  });

  it("un LenderProfile puede poseer más de una LenderCompany (BE-090, D-P1-3)", async () => {
    const { lenderProfile, lenderUser } = await createTestLenderCompany();

    const secondCompany = await prisma.lenderCompany.create({
      data: {
        lenderProfileId: lenderProfile.id,
        companyName: "Second Co",
        ein: `ein-second-${Date.now()}`,
        addressLine1: "1 Second St",
        city: "Austin",
        state: "TX",
        postalCode: "78703",
        createdByUserId: lenderUser.id,
      },
    });

    const companies = await prisma.lenderCompany.findMany({ where: { lenderProfileId: lenderProfile.id } });
    expect(companies).toHaveLength(2);
    expect(secondCompany.isOpenToDeals).toBe(true); // M-4, default
  });

  it("LenderCompany.ein es único a nivel de plataforma (riesgo #13/#14)", async () => {
    const { lenderProfile, lenderUser } = await createTestLenderCompany();
    const sharedEin = `ein-dup-${Date.now()}`;

    await prisma.lenderCompany.create({
      data: {
        lenderProfileId: lenderProfile.id,
        companyName: "Dup Co A",
        ein: sharedEin,
        addressLine1: "1 A St",
        city: "Austin",
        state: "TX",
        postalCode: "78704",
        createdByUserId: lenderUser.id,
      },
    });

    await expect(
      prisma.lenderCompany.create({
        data: {
          lenderProfileId: lenderProfile.id,
          companyName: "Dup Co B",
          ein: sharedEin,
          addressLine1: "1 B St",
          city: "Austin",
          state: "TX",
          postalCode: "78705",
          createdByUserId: lenderUser.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("BorrowerProfile no tiene lenderId — es a nivel de plataforma (BE-010, D-P1-4)", async () => {
    const { borrowerProfile } = await createTestBorrower();
    expect(borrowerProfile).not.toHaveProperty("lenderId");
  });

  it("un mismo deudor se vincula a dos LenderCompany distintas vía LenderBorrower (BE-091, formaliza M-1/C-1)", async () => {
    const { lenderCompany: companyA, lenderUser: userA } = await createTestLenderCompany();
    const { lenderCompany: companyB, lenderUser: userB } = await createTestLenderCompany();
    const { borrowerProfile } = await createTestBorrower();

    await prisma.lenderBorrower.create({
      data: { lenderCompanyId: companyA.id, borrowerProfileId: borrowerProfile.id, invitedByUserId: userA.id },
    });
    await prisma.lenderBorrower.create({
      data: { lenderCompanyId: companyB.id, borrowerProfileId: borrowerProfile.id, invitedByUserId: userB.id },
    });

    const links = await prisma.lenderBorrower.findMany({ where: { borrowerProfileId: borrowerProfile.id } });
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.status === "ACTIVE")).toBe(true);
  });

  it("el mismo par (lenderCompanyId, borrowerProfileId) no se puede vincular dos veces (BE-091)", async () => {
    const { lenderCompany, lenderUser } = await createTestLenderCompany();
    const { borrowerProfile } = await createTestBorrower();

    await prisma.lenderBorrower.create({
      data: {
        lenderCompanyId: lenderCompany.id,
        borrowerProfileId: borrowerProfile.id,
        invitedByUserId: lenderUser.id,
      },
    });

    await expect(
      prisma.lenderBorrower.create({
        data: {
          lenderCompanyId: lenderCompany.id,
          borrowerProfileId: borrowerProfile.id,
          invitedByUserId: lenderUser.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("quitar un vínculo marca status=REMOVED sin borrar la fila ni el BorrowerProfile (M-3)", async () => {
    const { lenderCompany, lenderUser } = await createTestLenderCompany();
    const { borrowerProfile } = await createTestBorrower();

    const link = await prisma.lenderBorrower.create({
      data: {
        lenderCompanyId: lenderCompany.id,
        borrowerProfileId: borrowerProfile.id,
        invitedByUserId: lenderUser.id,
      },
    });

    const removed = await prisma.lenderBorrower.update({
      where: { id: link.id },
      data: { status: "REMOVED", removedAt: new Date() },
    });
    expect(removed.status).toBe("REMOVED");

    const stillThere = await prisma.borrowerProfile.findUniqueOrThrow({ where: { id: borrowerProfile.id } });
    expect(stillThere.deletedAt).toBeNull();
  });

  it("un mismo Bookkeeper se vincula a dos LenderCompany (BE-092/093, D-P1-6)", async () => {
    const { lenderCompany: companyA, lenderUser: userA } = await createTestLenderCompany();
    const { lenderCompany: companyB, lenderUser: userB } = await createTestLenderCompany();

    const bookkeeperUser = await createTestUser("BOOKKEEPER");
    const bookkeeperProfile = await prisma.bookkeeperProfile.create({
      data: { userId: bookkeeperUser.id, createdByUserId: userA.id },
    });

    await prisma.lenderCompanyBookkeeper.create({
      data: { lenderCompanyId: companyA.id, bookkeeperProfileId: bookkeeperProfile.id, invitedByUserId: userA.id },
    });
    await prisma.lenderCompanyBookkeeper.create({
      data: { lenderCompanyId: companyB.id, bookkeeperProfileId: bookkeeperProfile.id, invitedByUserId: userB.id },
    });

    const links = await prisma.lenderCompanyBookkeeper.findMany({
      where: { bookkeeperProfileId: bookkeeperProfile.id },
    });
    expect(links).toHaveLength(2);
  });

  it("InsuranceCompanyProfile no cuelga de ninguna LenderCompany — es directorio de plataforma (BE-094, D-P1-7)", async () => {
    const admin = await createTestAdmin();
    const insuranceUser = await createTestUser("INSURANCE_COMPANY");

    const profile = await prisma.insuranceCompanyProfile.create({
      data: { userId: insuranceUser.id, companyName: "Acme Insurance", createdByAdminId: admin.id },
    });

    expect(profile.companyName).toBe("Acme Insurance");
    expect(profile).not.toHaveProperty("lenderCompanyId");
  });
});
