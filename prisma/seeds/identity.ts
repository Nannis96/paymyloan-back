import type { Prisma, User, UserRole } from "@prisma/client";
import { hashPassword } from "@/auth/password";
import { hashOpaqueToken } from "@/auth/jwt";
import { prisma } from "@/db/prisma";
import { DEV_PASSWORD, DEV_TOTP_SECRET, addDays, daysFromNow, ensureLink, audit, type Ctx } from "./ctx";

// Usuarios, perfiles, empresas, vínculos y tokens de auth. Estados cubiertos
// (≥3 casos c/u): LenderCompany ACTIVE/SUSPENDED, TenantLink ACTIVE/REMOVED,
// User activo/inactivo, mustChangePassword, 2FA, tokens vigentes/usados/vencidos.

export async function seedIdentity(): Promise<Ctx> {
  const password = await hashPassword(DEV_PASSWORD);
  const user = (name: string, email: string, role: UserRole, extra: Partial<Prisma.UserUncheckedCreateInput> = {}) =>
    prisma.user.create({ data: { name, email: `${email}@paymyloan.dev`, password, role, ...extra } });

  const admin = await user("Dev Admin", "admin", "ADMIN");
  const admin2fa = await user("Dev Admin 2FA", "admin2fa", "ADMIN", { isTwoFactorEnabled: true, twoFactorSecret: DEV_TOTP_SECRET });

  const ctx: Ctx = {
    password, admin, admin2fa, users: {}, lenders: {}, companies: {}, borrowers: {}, bookkeepers: {}, insurance: {},
    paymentMethods: {}, loanRequests: [], quotes: [], contracts: [], propertyCount: 0, contractCount: 0,
  };

  // --- Lenders ---------------------------------------------------------------
  const lender = async (key: string, name: string, extra: Partial<Prisma.UserUncheckedCreateInput>, byAdmin: boolean) => {
    const u = await user(name, key, "LENDER", extra);
    const profile = await prisma.lenderProfile.create({ data: { userId: u.id, createdByAdminId: byAdmin ? admin.id : null } });
    ctx.lenders[key] = { user: u, profile };
  };
  await lender("lender1", "Lender One", { phone: "5125550101" }, true);
  await lender("lender2", "Lender Two", { mustChangePassword: true }, true); // alta por Admin: contraseña temporal
  await lender("lender3", "Lender Three (self-registered)", {}, false);
  await lender("lender4", "Lender Four (inactive)", { isActive: false }, false);
  await lender("lender2fa", "Lender 2FA", { isTwoFactorEnabled: true, twoFactorSecret: DEV_TOTP_SECRET }, false);

  const company = async (key: string, lenderKey: string, name: string, ein: string, extra: Partial<Prisma.LenderCompanyUncheckedCreateInput> = {}) => {
    const l = ctx.lenders[lenderKey];
    ctx.companies[key] = await prisma.lenderCompany.create({
      data: {
        lenderProfileId: l.profile.id, companyName: name, ein, addressLine1: `${100 + Object.keys(ctx.companies).length * 50} Congress Ave`,
        city: "Austin", state: "TX", postalCode: "78701", createdByUserId: l.user.id, contactPhone: "5125559000", ...extra,
      },
    });
  };
  await company("A", "lender1", "Lone Star Capital LLC", "12-3456789");
  await company("B", "lender1", "Lone Star Capital II LLC", "12-3456790", { isOpenToDeals: false });
  await company("C", "lender2", "Hill Country Lending LLC", "98-7654321");
  await company("D", "lender3", "Blue Bonnet Bridge Loans LLC", "45-1122334");
  await company("E", "lender3", "Blue Bonnet Holdings LLC", "45-1122335", { status: "SUSPENDED", isOpenToDeals: false });
  await company("F", "lender4", "Gulf Coast Funding LLC", "61-2233445", { status: "SUSPENDED", isOpenToDeals: false });
  await company("G", "lender4", "Piney Woods Capital LLC", "61-2233446", { status: "SUSPENDED", isOpenToDeals: false });
  await company("H", "lender2fa", "Two Factor Lending LLC", "73-3344556");

  // --- Borrowers ---------------------------------------------------------------
  const borrower = async (key: string, name: string, extra: Partial<Prisma.UserUncheckedCreateInput>, profile: Partial<Prisma.BorrowerProfileUncheckedCreateInput> = {}) => {
    const u = await user(name, key, "BORROWER", extra);
    ctx.borrowers[key] = { user: u, profile: await prisma.borrowerProfile.create({ data: { userId: u.id, ...profile } }) };
  };
  await borrower("borrower1", "Borrower One", { phone: "5125550201" }, { addressLine1: "10 Main St", city: "Austin", state: "TX", postalCode: "78701" });
  await borrower("borrower2", "Borrower Two", {});
  await borrower("borrower3", "Borrower Three (multi-lender)", {});
  await borrower("borrower4", "Borrower Four", { phone: "5125550204" }, { city: "Dallas", state: "TX" });
  await borrower("borrower5", "Borrower Five", {});
  // Creado por el Lender (flujo "Lender da de alta al Deudor") → contraseña temporal.
  await borrower("borrower6", "Borrower Six (created by lender)", { mustChangePassword: true }, { createdByUserId: ctx.lenders.lender1.user.id });
  await borrower("borrower7", "Borrower Seven (links removed)", {});
  await borrower("borrower8", "Borrower Eight (inactive)", { isActive: false });
  await borrower("borrower2fa", "Borrower 2FA", { isTwoFactorEnabled: true, twoFactorSecret: DEV_TOTP_SECRET });

  // --- LenderBorrower: ACTIVE (los contratos/solicitudes crean los que falten) ---
  const links: [string, string, string?][] = [
    ["A", "borrower1", "Cliente desde 2024."], ["A", "borrower3", "Deudor recurrente, buen historial con Lone Star."], ["A", "borrower5"],
    ["B", "borrower6"], ["B", "borrower1"], ["C", "borrower2"], ["C", "borrower3"], ["C", "borrower4"],
    ["D", "borrower4"], ["D", "borrower5"], ["D", "borrower6"], ["B", "borrower8"],
  ];
  for (const [co, b, notes] of links) await ensureLink(ctx, co, b, notes);
  // REMOVED ×3
  for (const co of ["A", "C", "D"]) {
    const link = await ensureLink(ctx, co, "borrower7");
    await prisma.lenderBorrower.update({ where: { id: link.id }, data: { status: "REMOVED", removedAt: daysFromNow(-20) } });
    await audit({ action: "BORROWER_UNLINKED_FROM_LENDER", entityType: "LenderBorrower", entityId: link.id, actorUserId: ctx.lenders.lender1.user.id, lenderCompanyId: ctx.companies[co].id });
  }

  // --- Bookkeepers: ACTIVE ×3 / REMOVED ×3 --------------------------------------
  const bookkeeper = async (key: string, name: string, extra: Partial<Prisma.UserUncheckedCreateInput>) => {
    const u = await user(name, key, "BOOKKEEPER", extra);
    ctx.bookkeepers[key] = { user: u, profile: await prisma.bookkeeperProfile.create({ data: { userId: u.id, createdByUserId: ctx.lenders.lender1.user.id, phone: "5125550301" } }) };
  };
  await bookkeeper("bookkeeper1", "Dev Bookkeeper", {});
  await bookkeeper("bookkeeper2", "Dev Bookkeeper Two", { mustChangePassword: true });
  const bkLinks: [string, string, "ACTIVE" | "REMOVED"][] = [
    ["bookkeeper1", "A", "ACTIVE"], ["bookkeeper1", "C", "ACTIVE"], ["bookkeeper1", "D", "ACTIVE"],
    ["bookkeeper2", "A", "REMOVED"], ["bookkeeper2", "B", "REMOVED"], ["bookkeeper2", "C", "REMOVED"],
  ];
  for (const [bk, co, status] of bkLinks) {
    const link = await prisma.lenderCompanyBookkeeper.create({
      data: {
        lenderCompanyId: ctx.companies[co].id, bookkeeperProfileId: ctx.bookkeepers[bk].profile.id,
        invitedByUserId: ctx.lenders.lender1.user.id, status, removedAt: status === "REMOVED" ? daysFromNow(-15) : null,
      },
    });
    await audit({ action: status === "ACTIVE" ? "BOOKKEEPER_LINKED_TO_LENDER" : "BOOKKEEPER_UNLINKED_FROM_LENDER", entityType: "LenderCompanyBookkeeper", entityId: link.id, actorUserId: ctx.lenders.lender1.user.id, lenderCompanyId: ctx.companies[co].id });
  }

  // --- Insurance companies (directorio de plataforma) ----------------------------
  const insurance = async (key: string, name: string, companyName: string, extra: Partial<Prisma.UserUncheckedCreateInput> = {}) => {
    const u = await user(name, key, "INSURANCE_COMPANY", extra);
    ctx.insurance[key] = await prisma.insuranceCompanyProfile.create({
      data: { userId: u.id, companyName, createdByAdminId: admin.id, contactPhone: "5125550400", licenseNumber: `TX-${key.slice(-1)}00123` },
    });
  };
  await insurance("insurance1", "Dev Insurance Co", "Capitol Title & Insurance");
  await insurance("insurance2", "Dev Insurance Two", "Lone Star Surety Group");
  await insurance("insurance3", "Dev Insurance Three (inactive)", "Alamo Mutual Insurance", { isActive: false });

  for (const [key, c] of Object.entries(ctx.companies)) {
    await audit({ action: "LENDER_COMPANY_CREATED", entityType: "LenderCompany", entityId: c.id, actorUserId: ownerUserId(ctx, key), lenderCompanyId: c.id });
    if (c.status === "SUSPENDED") await audit({ action: "LENDER_COMPANY_SUSPENDED", entityType: "LenderCompany", entityId: c.id, actorUserId: admin.id, lenderCompanyId: c.id });
  }
  await audit({ action: "USER_DEACTIVATED", entityType: "User", entityId: ctx.lenders.lender4.user.id, actorUserId: admin.id });

  await seedAuthTokens(ctx);
  ctx.users = Object.fromEntries(await prisma.user.findMany().then((rows) => rows.map((r) => [r.email.split("@")[0], r])));
  return ctx;
}

const ownerUserId = (ctx: Ctx, companyKey: string) =>
  Object.values(ctx.lenders).find((l) => l.profile.id === ctx.companies[companyKey].lenderProfileId)!.user.id;

// RefreshToken (vigente/revocado/vencido/rotado), PasswordResetToken
// (pendiente/usado/vencido), TwoFactorRecoveryCode (libre/usado).
async function seedAuthTokens(ctx: Ctx) {
  const ids: User[] = [ctx.admin, ctx.lenders.lender1.user, ctx.borrowers.borrower1.user, ctx.borrowers.borrower2.user];
  const tok = (label: string) => hashOpaqueToken(`seed-${label}`);

  for (const [i, u] of ids.entries()) {
    await prisma.refreshToken.create({ data: { userId: u.id, tokenHash: tok(`rt-active-${i}`), expiresAt: daysFromNow(30), userAgent: "Mozilla/5.0 (seed)", ipAddress: "127.0.0.1" } });
    await prisma.refreshToken.create({ data: { userId: u.id, tokenHash: tok(`rt-expired-${i}`), expiresAt: daysFromNow(-5), userAgent: "Mozilla/5.0 (seed)", ipAddress: "127.0.0.1" } });
    const next = await prisma.refreshToken.create({ data: { userId: u.id, tokenHash: tok(`rt-rotated-next-${i}`), expiresAt: daysFromNow(29) } });
    await prisma.refreshToken.create({ data: { userId: u.id, tokenHash: tok(`rt-rotated-${i}`), expiresAt: daysFromNow(25), revokedAt: daysFromNow(-1), replacedByTokenId: next.id } });
    if (i < 3) await prisma.refreshToken.create({ data: { userId: u.id, tokenHash: tok(`rt-revoked-${i}`), expiresAt: daysFromNow(10), revokedAt: daysFromNow(-2) } });
  }

  const reset = (label: string, userId: string, expiresAt: Date, usedAt?: Date) =>
    prisma.passwordResetToken.create({ data: { userId, tokenHash: tok(`pr-${label}`), expiresAt, usedAt } });
  await reset("pending-1", ctx.borrowers.borrower3.user.id, daysFromNow(0.04));
  await reset("pending-2", ctx.borrowers.borrower4.user.id, daysFromNow(0.04));
  await reset("pending-3", ctx.lenders.lender3.user.id, daysFromNow(0.04));
  await reset("used-1", ctx.borrowers.borrower5.user.id, addDays(daysFromNow(-3), 0.04), daysFromNow(-3));
  await reset("used-2", ctx.lenders.lender1.user.id, addDays(daysFromNow(-6), 0.04), daysFromNow(-6));
  await reset("used-3", ctx.borrowers.borrower1.user.id, addDays(daysFromNow(-9), 0.04), daysFromNow(-9));
  await reset("expired-1", ctx.borrowers.borrower6.user.id, daysFromNow(-2));
  await reset("expired-2", ctx.lenders.lender2.user.id, daysFromNow(-4));
  await reset("expired-3", ctx.borrowers.borrower2.user.id, daysFromNow(-7));

  // 8 códigos por usuario con 2FA; los primeros 3 ya consumidos.
  for (const u of [ctx.admin2fa, ctx.lenders.lender2fa.user, ctx.borrowers.borrower2fa.user]) {
    for (let n = 1; n <= 8; n++) {
      await prisma.twoFactorRecoveryCode.create({
        data: { userId: u.id, codeHash: hashOpaqueToken(`${u.email}-recovery-${n}`), usedAt: n <= 3 ? daysFromNow(-n) : null },
      });
    }
    await audit({ action: "USER_2FA_ENABLED", entityType: "User", entityId: u.id, actorUserId: u.id });
  }
}
