import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/prisma";
import { logAuditEvent } from "@/lib/audit";
import {
  createTestBorrower,
  createTestContract,
  createTestLenderCompany,
  createTestProperty,
  createTestUser,
  resetPhase1Tables,
} from "@/db/testFixtures";

// BE-015 (ScheduledPayment), BE-016 (Transaction + PAYOFF_PAYMENT, M-5),
// BE-017 (TransactionAllocation), BE-018 (PaymentMethod), BE-096 (Autopay,
// M-6), BE-019 (WebhookEvent), BE-020 (AuditLog), BE-021 (RefreshToken /
// PasswordResetToken / TwoFactorRecoveryCode) — ver
// Docs/plan/16-fase-1-actualizada.md.
describe("Fase 1 — Pagos, webhooks, auditoría y tokens de auth", () => {
  afterAll(resetPhase1Tables);

  async function buildContract() {
    const { lenderCompany, lenderUser } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const contract = await createTestContract({
      lenderCompanyId: lenderCompany.id,
      propertyId: property.id,
      createdByUserId: lenderUser.id,
    });
    const terms = await prisma.contractTerms.create({
      data: {
        contractId: contract.id,
        versionNumber: 1,
        structure: "AMORTIZED",
        principalAmount: "150000.00",
        interestRate: "8.125",
        amortizationTermMonths: 360,
        firstPaymentDate: new Date("2026-11-01"),
        paymentDueDay: 1,
        maturityDate: new Date("2027-10-01"),
        lateFeeType: "FLAT",
        lateFeeAmount: "50.00",
        createdByUserId: lenderUser.id,
      },
    });
    return { lenderCompany, lenderUser, property, contract, terms };
  }

  it("ScheduledPayment es único por (contractTermsId, sequenceNumber) — nunca nace PAID (BE-015)", async () => {
    const { contract, terms } = await buildContract();

    const scheduled = await prisma.scheduledPayment.create({
      data: {
        contractId: contract.id,
        contractTermsId: terms.id,
        sequenceNumber: 1,
        dueDate: new Date("2026-11-01"),
        principalDue: "200.00",
        interestDue: "1015.63",
        totalDue: "1215.63",
        projectedRemainingBalance: "149800.00",
      },
    });
    expect(scheduled.status).toBe("PENDING");
    expect(scheduled.amountPaid.toString()).toBe("0");

    await expect(
      prisma.scheduledPayment.create({
        data: {
          contractId: contract.id,
          contractTermsId: terms.id,
          sequenceNumber: 1,
          dueDate: new Date("2026-12-01"),
          principalDue: "200.00",
          interestDue: "1015.63",
          totalDue: "1215.63",
          projectedRemainingBalance: "149600.00",
        },
      }),
    ).rejects.toThrow();
  });

  it("Transaction acepta type=PAYOFF_PAYMENT, repuesto en el enum (BE-016, formaliza M-5)", async () => {
    const { contract } = await buildContract();

    const tx = await prisma.transaction.create({
      data: { contractId: contract.id, type: "PAYOFF_PAYMENT", amount: "148000.00" },
    });

    expect(tx.type).toBe("PAYOFF_PAYMENT");
    expect(tx.status).toBe("PENDING"); // nunca nace SUCCEEDED
  });

  it("Transaction.stripePaymentIntentId único permite múltiples null (pagos manuales) (BE-016)", async () => {
    const { contract } = await buildContract();

    const manual1 = await prisma.transaction.create({
      data: { contractId: contract.id, type: "SCHEDULED_PAYMENT", amount: "1215.63", method: "CHECK" },
    });
    const manual2 = await prisma.transaction.create({
      data: { contractId: contract.id, type: "SCHEDULED_PAYMENT", amount: "1215.63", method: "WIRE" },
    });

    expect(manual1.stripePaymentIntentId).toBeNull();
    expect(manual2.stripePaymentIntentId).toBeNull();
  });

  it("TransactionAllocation reparte una transacción entre mora/interés/capital (BE-017)", async () => {
    const { contract, terms } = await buildContract();
    const scheduled = await prisma.scheduledPayment.create({
      data: {
        contractId: contract.id,
        contractTermsId: terms.id,
        sequenceNumber: 1,
        dueDate: new Date("2026-11-01"),
        principalDue: "200.00",
        interestDue: "1015.63",
        totalDue: "1215.63",
        projectedRemainingBalance: "149800.00",
      },
    });
    const tx = await prisma.transaction.create({
      data: { contractId: contract.id, type: "SCHEDULED_PAYMENT", amount: "1215.63" },
    });

    const allocations = await prisma.$transaction([
      prisma.transactionAllocation.create({
        data: { transactionId: tx.id, scheduledPaymentId: scheduled.id, allocationType: "INTEREST", amount: "1015.63" },
      }),
      prisma.transactionAllocation.create({
        data: { transactionId: tx.id, scheduledPaymentId: scheduled.id, allocationType: "PRINCIPAL", amount: "200.00" },
      }),
    ]);

    expect(allocations).toHaveLength(2);
    const total = allocations.reduce((sum, a) => sum + Number(a.amount), 0);
    expect(total).toBeCloseTo(1215.63);
  });

  it("PaymentMethod.stripePaymentMethodId es único (BE-018)", async () => {
    const { borrowerProfile } = await createTestBorrower();

    await prisma.paymentMethod.create({
      data: {
        userId: borrowerProfile.userId,
        stripeCustomerId: "cus_test_1",
        stripePaymentMethodId: "pm_dup_test",
        last4: "4242",
      },
    });

    await expect(
      prisma.paymentMethod.create({
        data: {
          userId: borrowerProfile.userId,
          stripeCustomerId: "cus_test_2",
          stripePaymentMethodId: "pm_dup_test",
          last4: "1111",
        },
      }),
    ).rejects.toThrow();
  });

  it("Autopay existe modelada pero sin activar — se puede insertar y consultar sola (BE-096, M-6/A-2)", async () => {
    const { contract } = await buildContract();
    const { borrowerProfile } = await createTestBorrower();
    const paymentMethod = await prisma.paymentMethod.create({
      data: {
        userId: borrowerProfile.userId,
        stripeCustomerId: "cus_autopay",
        stripePaymentMethodId: `pm_autopay_${Date.now()}`,
        last4: "4242",
      },
    });

    const autopay = await prisma.autopay.create({
      data: {
        contractId: contract.id,
        borrowerProfileId: borrowerProfile.id,
        paymentMethodId: paymentMethod.id,
        amountType: "SCHEDULED_AMOUNT_DUE",
      },
    });

    expect(autopay.status).toBe("ACTIVE");
  });

  it("WebhookEvent.externalEventId es único — un evento repetido de Stripe se rechaza (BE-019, D9)", async () => {
    const eventId = `evt_${Date.now()}`;
    await prisma.webhookEvent.create({
      data: { externalEventId: eventId, eventType: "payment_intent.succeeded", payload: { ok: true } },
    });

    await expect(
      prisma.webhookEvent.create({
        data: { externalEventId: eventId, eventType: "payment_intent.succeeded", payload: { ok: true } },
      }),
    ).rejects.toThrow();
  });

  it("AuditLog es de solo inserción — no tiene columna updatedAt (BE-020)", async () => {
    const log = await prisma.auditLog.create({
      data: { action: "TEST_EVENT", entityType: "Test", isSystemActor: true, systemActorLabel: "test_suite" },
    });

    expect(log).not.toHaveProperty("updatedAt");
    expect(log.lenderCompanyId).toBeNull();
    expect(log.contractId).toBeNull();
  });

  it("AuditLog acepta lenderCompanyId y contractId denormalizados (BE-020, D-P1-3)", async () => {
    const { contract, lenderCompany, lenderUser } = await buildContract();

    const log = await prisma.auditLog.create({
      data: {
        actorUserId: lenderUser.id,
        action: "CONTRACT_CREATED",
        entityType: "Contract",
        entityId: contract.id,
        lenderCompanyId: lenderCompany.id,
        contractId: contract.id,
      },
    });

    expect(log.lenderCompanyId).toBe(lenderCompany.id);
    expect(log.contractId).toBe(contract.id);
  });

  it("logAuditEvent() infiere isSystemActor cuando no hay actorUserId (BE-020)", async () => {
    const { contract, lenderCompany } = await buildContract();

    await logAuditEvent({
      action: "CONTRACT_CREATED",
      entityType: "Contract",
      entityId: contract.id,
      lenderCompanyId: lenderCompany.id,
      contractId: contract.id,
      systemActorLabel: "test_suite",
    });

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: contract.id, action: "CONTRACT_CREATED" },
    });
    expect(log.isSystemActor).toBe(true);
    expect(log.actorUserId).toBeNull();
    expect(log.systemActorLabel).toBe("test_suite");
  });

  it("RefreshToken / PasswordResetToken / TwoFactorRecoveryCode exigen hash único (BE-021)", async () => {
    const user = await createTestUser("BORROWER");

    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: "dup-hash", expiresAt: new Date(Date.now() + 1000 * 60) },
    });
    await expect(
      prisma.refreshToken.create({
        data: { userId: user.id, tokenHash: "dup-hash", expiresAt: new Date(Date.now() + 1000 * 60) },
      }),
    ).rejects.toThrow();

    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: "dup-reset-hash", expiresAt: new Date(Date.now() + 1000 * 60) },
    });
    await expect(
      prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: "dup-reset-hash", expiresAt: new Date(Date.now() + 1000 * 60) },
      }),
    ).rejects.toThrow();

    await prisma.twoFactorRecoveryCode.create({ data: { userId: user.id, codeHash: "dup-code-hash" } });
    await expect(
      prisma.twoFactorRecoveryCode.create({ data: { userId: user.id, codeHash: "dup-code-hash" } }),
    ).rejects.toThrow();
  });
});
