import { Prisma, type User } from "@prisma/client";
import { durationToMs, generateOpaqueToken, hashOpaqueToken, signAccessToken, signPendingToken, verifyPendingToken } from "@/auth/jwt";
import { hashPassword, verifyDummyPassword, verifyPassword } from "@/auth/password";
import { verifyCode as verifyTotpCode } from "@/auth/totp";
import { env } from "@/config/env";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";
import { type SafeUser, toSafeUser } from "@/services/users.service";
import type { LoginInput, LoginTwoFactorInput, RegisterInput } from "@/validations/auth.validation";

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginSuccessResult extends AuthTokens {
  requiresTwoFactor: false;
  user: SafeUser;
}

export interface LoginPendingResult {
  requiresTwoFactor: true;
  pendingToken: string;
}

export type LoginResult = LoginSuccessResult | LoginPendingResult;

const GENERIC_CREDENTIALS_ERROR = "Correo o contraseña incorrectos";

async function issueSession(user: User, meta: RequestMeta): Promise<AuthTokens> {
  const accessToken = await signAccessToken({ sub: user.id, role: user.role });
  const refreshTokenPlain = generateOpaqueToken();

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashOpaqueToken(refreshTokenPlain),
      expiresAt: new Date(Date.now() + durationToMs(env.jwtRefreshTtl)),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    },
  });

  return { accessToken, refreshToken: refreshTokenPlain };
}

// BE-027. Paso 1 del login (§7.2). El mismo mensaje/código 401 cubre tanto
// "el correo no existe" como "la contraseña es incorrecta" — y en el primer
// caso igual se corre un bcrypt.compare contra un hash dummy, para que el
// tiempo de respuesta no delate cuál de los dos casos fue (criterio de
// aceptación explícito de BE-027).
export async function login(input: LoginInput & RequestMeta): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user || user.deletedAt) {
    await verifyDummyPassword(input.password);
    await logAuditEvent({
      action: "USER_LOGIN_FAILED",
      entityType: "User",
      metadata: { email: input.email, reason: "not_found" },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    throw new AppError(GENERIC_CREDENTIALS_ERROR, 401, "INVALID_CREDENTIALS");
  }

  const passwordOk = await verifyPassword(input.password, user.password);
  if (!passwordOk) {
    await logAuditEvent({
      action: "USER_LOGIN_FAILED",
      entityType: "User",
      entityId: user.id,
      actorUserId: user.id,
      metadata: { reason: "bad_password" },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    throw new AppError(GENERIC_CREDENTIALS_ERROR, 401, "INVALID_CREDENTIALS");
  }

  // Se revisa recién después de validar la contraseña — así isActive=false
  // no sirve para enumerar cuentas (un 403 antes de verificar password sí
  // delataría que el correo existe).
  if (!user.isActive) {
    throw new AppError("La cuenta no está activa", 403, "ACCOUNT_INACTIVE");
  }

  if (user.isTwoFactorEnabled) {
    const pendingToken = await signPendingToken(user.id);
    return { requiresTwoFactor: true, pendingToken };
  }

  const tokens = await issueSession(user, input);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await logAuditEvent({
    action: "USER_LOGIN_SUCCESS",
    entityType: "User",
    entityId: user.id,
    actorUserId: user.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return { requiresTwoFactor: false, ...tokens, user: toSafeUser(user) };
}

async function consumeRecoveryCodeIfValid(userId: string, code: string): Promise<boolean> {
  const codeHash = hashOpaqueToken(code);
  const recoveryCode = await prisma.twoFactorRecoveryCode.findUnique({ where: { codeHash } });
  if (!recoveryCode || recoveryCode.userId !== userId || recoveryCode.usedAt) {
    return false;
  }
  await prisma.twoFactorRecoveryCode.update({ where: { id: recoveryCode.id }, data: { usedAt: new Date() } });
  return true;
}

// BE-028. Paso 2, solo alcanzable con un pendingToken válido de login().
// Acepta tanto un código TOTP como un recovery code de un solo uso (§7.2).
export async function loginTwoFactor(input: LoginTwoFactorInput & RequestMeta): Promise<LoginSuccessResult> {
  const { sub: userId } = await verifyPendingToken(input.pendingToken);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt || !user.isActive || !user.isTwoFactorEnabled || !user.twoFactorSecret) {
    throw new AppError("Sesión de verificación en dos pasos inválida", 401, "INVALID_CREDENTIALS");
  }

  const totpValid = verifyTotpCode(user.twoFactorSecret, input.code);
  const usedRecoveryCode = totpValid ? false : await consumeRecoveryCodeIfValid(user.id, input.code);

  if (!totpValid && !usedRecoveryCode) {
    await logAuditEvent({
      action: "USER_LOGIN_FAILED",
      entityType: "User",
      entityId: user.id,
      actorUserId: user.id,
      metadata: { reason: "bad_2fa_code" },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    throw new AppError("Código de verificación inválido", 401, "INVALID_2FA_CODE");
  }

  const tokens = await issueSession(user, input);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await logAuditEvent({
    action: "USER_LOGIN_SUCCESS",
    entityType: "User",
    entityId: user.id,
    actorUserId: user.id,
    metadata: { via: usedRecoveryCode ? "recovery_code" : "totp" },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return { requiresTwoFactor: false, ...tokens, user: toSafeUser(user) };
}

// BE-029. Rota siempre; si el token presentado ya estaba revocado (reuso de
// uno viejo tras una rotación anterior) revoca TODA la cadena del usuario
// — señal de robo (§7.2).
export async function refresh(input: { refreshToken: string } & RequestMeta): Promise<LoginSuccessResult> {
  const tokenHash = hashOpaqueToken(input.refreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!stored) {
    throw new AppError("Refresh token inválido", 401, "INVALID_TOKEN");
  }

  if (stored.revokedAt) {
    // Solo el reuso de un token que fue ROTADO (replacedByTokenId set) es
    // señal de robo y amerita revocar toda la cadena (§7.2). Un token
    // revocado por logout() de esa misma sesión, sin más, es simplemente
    // inválido — no debe tumbar las demás sesiones del usuario en otros
    // dispositivos.
    if (stored.replacedByTokenId) {
      await prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    throw new AppError("Refresh token inválido", 401, "INVALID_TOKEN");
  }

  if (stored.expiresAt < new Date()) {
    throw new AppError("Refresh token expirado", 401, "INVALID_TOKEN");
  }

  const user = await prisma.user.findUnique({ where: { id: stored.userId } });
  if (!user || user.deletedAt || !user.isActive) {
    throw new AppError("Refresh token inválido", 401, "INVALID_TOKEN");
  }

  const accessToken = await signAccessToken({ sub: user.id, role: user.role });
  const refreshTokenPlain = generateOpaqueToken();

  const newToken = await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashOpaqueToken(refreshTokenPlain),
      expiresAt: new Date(Date.now() + durationToMs(env.jwtRefreshTtl)),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
  });
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date(), replacedByTokenId: newToken.id },
  });

  return { requiresTwoFactor: false, accessToken, refreshToken: refreshTokenPlain, user: toSafeUser(user) };
}

// BE-030.
export async function logout(refreshToken: string): Promise<void> {
  const tokenHash = hashOpaqueToken(refreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function logoutAll(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export interface MeResult {
  user: SafeUser;
  lenderProfile?: {
    id: string;
    contactPhone: string | null;
    lenderCompanies: { id: string; companyName: string; status: string; isOpenToDeals: boolean }[];
  };
  borrowerProfile?: {
    id: string;
    phone: string | null;
    lenderCompanies: { id: string; companyName: string }[];
  };
}

// BE-031. Sin `lenderId` resuelto en el JWT (D-P2-2), el cliente necesita
// esta lista para poder elegir con qué LenderCompany está operando — Fase 3
// decide cómo esa elección viaja en requests posteriores (riesgo #18).
export async function getMe(userId: string): Promise<MeResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) {
    throw new AppError("Usuario no encontrado", 404, "USER_NOT_FOUND");
  }

  const result: MeResult = { user: toSafeUser(user) };

  if (user.role === "LENDER") {
    const lenderProfile = await prisma.lenderProfile.findUnique({
      where: { userId: user.id },
      include: { lenderCompanies: { where: { deletedAt: null } } },
    });
    if (lenderProfile) {
      result.lenderProfile = {
        id: lenderProfile.id,
        contactPhone: lenderProfile.contactPhone,
        lenderCompanies: lenderProfile.lenderCompanies.map((company) => ({
          id: company.id,
          companyName: company.companyName,
          status: company.status,
          isOpenToDeals: company.isOpenToDeals,
        })),
      };
    }
  }

  if (user.role === "BORROWER") {
    const borrowerProfile = await prisma.borrowerProfile.findUnique({
      where: { userId: user.id },
      include: { lenders: { where: { status: "ACTIVE" }, include: { lenderCompany: true } } },
    });
    if (borrowerProfile) {
      result.borrowerProfile = {
        id: borrowerProfile.id,
        phone: borrowerProfile.phone,
        lenderCompanies: borrowerProfile.lenders.map((link) => ({
          id: link.lenderCompany.id,
          companyName: link.lenderCompany.companyName,
        })),
      };
    }
  }

  return result;
}

const REGISTER_RESPONSE_MESSAGE =
  "Si los datos son válidos, tu cuenta quedará pendiente de activación. " +
  "Una vez que un administrador la active, recibirás un correo con tu contraseña temporal.";

// PB-013 / D-P2-1. LENDER y BORROWER pueden auto-registrarse (D-P1-10);
// nacen `isActive=false` y sin contraseña utilizable — el registro nunca la
// pide. La respuesta es siempre el mismo mensaje genérico, exista o no el
// correo (misma postura anti-enumeración que password/forgot, §7.3).
export async function register(input: RegisterInput): Promise<{ message: string }> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    return { message: REGISTER_RESPONSE_MESSAGE };
  }

  const placeholderPassword = await hashPassword(generateOpaqueToken());

  let createdUserId: string;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          role: input.role,
          password: placeholderPassword,
          isActive: false,
        },
      });

      if (input.role === "LENDER") {
        await tx.lenderProfile.create({ data: { userId: user.id, createdByAdminId: null } });
      } else {
        await tx.borrowerProfile.create({ data: { userId: user.id, createdByUserId: null } });
      }

      return user;
    });
    createdUserId = created.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Carrera con otro registro concurrente para el mismo correo — mismo
      // resultado que "ya existía": no se filtra la diferencia.
      return { message: REGISTER_RESPONSE_MESSAGE };
    }
    throw error;
  }

  await logAuditEvent({
    action: input.role === "LENDER" ? "LENDER_CREATED" : "BORROWER_CREATED",
    entityType: "User",
    entityId: createdUserId,
    actorUserId: createdUserId,
    metadata: { selfRegistered: true },
  });

  return { message: REGISTER_RESPONSE_MESSAGE };
}
