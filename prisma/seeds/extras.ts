import type { EntityType } from "@prisma/client";
import { prisma } from "@/db/prisma";
import type { NotificationEntityType, NotificationType } from "@/lib/notify";
import { audit, daysFromNow, ownerOf, type Ctx } from "./ctx";

// VerificationRequest (PENDING/APPROVED/REJECTED × 3), Message (hilos con leídos y
// no leídos), Review (ratings 1..5, ambas direcciones) y Notification (8 tipos × 3).
export async function seedExtras(ctx: Ctx) {
  await seedVerifications(ctx);
  await seedMessages(ctx);
  await seedReviews(ctx);
  await seedNotifications(ctx);
}

async function seedVerifications(ctx: Ctx) {
  type V = { co?: string; b?: string; status: "PENDING" | "APPROVED" | "REJECTED"; type: EntityType; name: string; ein: string; reason?: string };
  const list: V[] = [
    { co: "D", status: "PENDING", type: "LLC", name: "Blue Bonnet Bridge Loans LLC", ein: "45-1122334" },
    { b: "borrower5", status: "PENDING", type: "INDIVIDUAL", name: "Borrower Five", ein: "20-1000005" },
    { b: "borrower6", status: "PENDING", type: "OTHER", name: "Six Land Trust", ein: "20-1000006" },
    { co: "A", status: "APPROVED", type: "LLC", name: "Lone Star Capital LLC", ein: "12-3456789" },
    { co: "C", status: "APPROVED", type: "CORPORATION", name: "Hill Country Lending Corp", ein: "98-7654321" },
    { b: "borrower1", status: "APPROVED", type: "LLC", name: "Borrower One Holdings LLC", ein: "20-1000001" },
    { co: "B", status: "REJECTED", type: "LP", name: "Lone Star Capital II LP", ein: "12-3456790", reason: "El EIN no coincide con el nombre de la entidad." },
    { b: "borrower2", status: "REJECTED", type: "TRUST", name: "Two Family Trust", ein: "20-1000002", reason: "Documentación ilegible." },
    { b: "borrower3", status: "REJECTED", type: "OTHER", name: "Three Ventures", ein: "20-1000003", reason: "Estado de formación inválido." },
  ];

  for (const v of list) {
    const submitter = v.co ? ownerOf(ctx, v.co) : ctx.borrowers[v.b!].user;
    const reviewed = v.status !== "PENDING";
    const vr = await prisma.verificationRequest.create({
      data: {
        lenderCompanyId: v.co ? ctx.companies[v.co].id : null, borrowerProfileId: v.b ? ctx.borrowers[v.b].profile.id : null,
        status: v.status, entityName: v.name, entityType: v.type, ein: v.ein, stateOfFormation: "TX",
        signatoryName: submitter.name, signatoryTitle: "Managing Member", submittedByUserId: submitter.id,
        reviewedByUserId: reviewed ? ctx.admin.id : null, reviewedAt: reviewed ? daysFromNow(-5) : null, rejectionReason: v.reason,
      },
    });
    await audit({ action: "VERIFICATION_SUBMITTED", entityType: "VerificationRequest", entityId: vr.id, actorUserId: submitter.id, lenderCompanyId: v.co ? ctx.companies[v.co].id : undefined });
    if (reviewed) await audit({ action: v.status === "APPROVED" ? "VERIFICATION_APPROVED" : "VERIFICATION_REJECTED", entityType: "VerificationRequest", entityId: vr.id, actorUserId: ctx.admin.id });
  }
}

const THREADS: [company: string, borrower: string, topic: string][] = [
  ["A", "borrower1", "el calendario de pagos"], ["C", "borrower2", "el seguro de la propiedad"], ["D", "borrower4", "los términos renegociados"],
  ["A", "borrower3", "la mora pendiente"], ["C", "borrower3", "los documentos del contrato"],
];

async function seedMessages(ctx: Ctx) {
  for (const [t, [co, b, topic]] of THREADS.entries()) {
    const lenderUser = ownerOf(ctx, co);
    const borrowerUser = ctx.borrowers[b].user;
    const lines: [("LENDER" | "BORROWER"), string][] = [
      ["BORROWER", `Hola, tengo una consulta sobre ${topic}.`],
      ["LENDER", "Claro, te cuento los detalles esta semana."],
      ["BORROWER", "Perfecto, ¿puedes enviarme un resumen?"],
      ["LENDER", "Te lo mando mañana por la mañana."],
    ];
    for (const [i, [role, body]] of lines.entries()) {
      const unread = i >= lines.length - 1 - (t % 2); // los últimos 1-2 mensajes de cada hilo sin leer
      await prisma.message.create({
        data: {
          lenderCompanyId: ctx.companies[co].id, borrowerProfileId: ctx.borrowers[b].profile.id,
          senderUserId: role === "LENDER" ? lenderUser.id : borrowerUser.id, senderRole: role, body,
          readAt: unread ? null : daysFromNow(-t - 1), createdAt: daysFromNow(-t - 2 + i * 0.1),
        },
      });
    }
  }
}

async function seedReviews(ctx: Ctx) {
  const c = (key: string) => ctx.contracts.find((e) => e.spec.key === key)!;
  const list: [string, "LENDER_TO_BORROWER" | "BORROWER_TO_LENDER", number, string | null][] = [
    ["paid1", "LENDER_TO_BORROWER", 5, "Excelente pagador, sin atrasos."], ["paid1", "BORROWER_TO_LENDER", 4, "Proceso claro y rápido."],
    ["paid2", "LENDER_TO_BORROWER", 4, "Cumplió el payoff como se acordó."], ["paid2", "BORROWER_TO_LENDER", 5, "Muy profesional."],
    ["paid3", "LENDER_TO_BORROWER", 3, null], ["paid3", "BORROWER_TO_LENDER", 3, null],
    ["active1", "BORROWER_TO_LENDER", 5, "Gran comunicación durante todo el préstamo."],
    ["delinq1", "LENDER_TO_BORROWER", 2, "Pagos atrasados varios meses."], ["delinq2", "LENDER_TO_BORROWER", 1, "Sin respuesta ante la mora."],
    ["delinq2", "BORROWER_TO_LENDER", 2, "Cargos por mora poco claros."],
  ];
  for (const [key, direction, rating, comment] of list) {
    const e = c(key);
    const borrower = ctx.borrowers[e.spec.borrowers[0]];
    await prisma.review.create({
      data: {
        contractId: e.contract.id, lenderCompanyId: e.contract.lenderCompanyId, borrowerProfileId: borrower.profile.id, direction, rating, comment,
        reviewerUserId: direction === "LENDER_TO_BORROWER" ? ownerOf(ctx, e.spec.company).id : borrower.user.id,
      },
    });
  }
}

async function seedNotifications(ctx: Ctx) {
  const lenderOf = (companyId: string) => Object.values(ctx.lenders).find((l) => ctx.companies[Object.keys(ctx.companies).find((k) => ctx.companies[k].id === companyId)!].lenderProfileId === l.profile.id)!.user.id;
  const borrowerUserOf = (profileId: string) => Object.values(ctx.borrowers).find((b) => b.profile.id === profileId)!.user.id;
  const reqs = (s: string) => ctx.loanRequests.filter((r) => r.status === s).slice(0, 3);
  const quotes = (s: string) => ctx.quotes.filter((q) => q.status === s).slice(0, 3);
  const contracts = (s: string) => ctx.contracts.filter((e) => e.spec.status === s).slice(0, 3);
  const principal = (e: (typeof ctx.contracts)[number]) => ctx.borrowers[e.spec.borrowers[0]].user.id;

  type N = [NotificationType, string, string, string, string, NotificationEntityType][]; // type,userId,title,body,entityId,entityType
  const n: N = [];
  for (const r of reqs("PUBLISHED")) {
    const q = ctx.quotes.find((x) => x.loanRequestId === r.id)!;
    n.push(["LOAN_QUOTE_REQUESTED", lenderOf(q.lenderCompanyId), "New loan request", "A borrower is asking for quotes on a new loan request.", r.id, "LoanRequest"]);
  }
  for (const q of quotes("SUBMITTED")) {
    const r = ctx.loanRequests.find((x) => x.id === q.loanRequestId)!;
    n.push(["LOAN_QUOTE_RECEIVED", borrowerUserOf(r.borrowerProfileId), "New quote received", "A lender sent you a quote for your loan request.", q.id, "LoanQuote"]);
  }
  for (const q of quotes("SELECTED")) n.push(["LOAN_QUOTE_SELECTED", lenderOf(q.lenderCompanyId), "Your quote was selected", "The borrower selected your quote.", q.id, "LoanQuote"]);
  for (const e of contracts("PENDING_ACCEPTANCE")) n.push(["CONTRACT_TERMS_SUBMITTED", principal(e), "Terms ready for review", `Review the terms of contract ${e.contract.contractNumber}.`, e.contract.id, "Contract"]);
  for (const e of contracts("ACTIVE")) {
    n.push(["CONTRACT_TERMS_ACCEPTED", ownerOf(ctx, e.spec.company).id, "Terms accepted", `The terms of contract ${e.contract.contractNumber} were accepted.`, e.contract.id, "Contract"]);
    n.push(["CONTRACT_ACTIVATED", principal(e), "Contract active", `Contract ${e.contract.contractNumber} is now active.`, e.contract.id, "Contract"]);
  }
  for (const e of contracts("CANCELLED")) n.push(["CONTRACT_TERMS_REJECTED", ownerOf(ctx, e.spec.company).id, "Terms rejected", `The borrower rejected the terms of contract ${e.contract.contractNumber}.`, e.contract.id, "Contract"]);
  for (const [i, [co, b]] of THREADS.slice(0, 3).entries()) {
    n.push(["MESSAGE_RECEIVED", ctx.borrowers[b].user.id, "New message", "You have a new message from your lender.", ctx.companies[co].id, "MessageThread"]);
    if (i < 2) n.push(["MESSAGE_RECEIVED", ownerOf(ctx, co).id, "New message", "You have a new message from a borrower.", ctx.borrowers[b].profile.id, "MessageThread"]);
  }

  const seen: Record<string, number> = {};
  for (const [type, userId, title, body, id, entityType] of n) {
    const i = (seen[type] = (seen[type] ?? -1) + 1);
    const isRead = i % 3 === 0;
    await prisma.notification.create({
      data: { userId, type, title, body, relatedEntityType: entityType, relatedEntityId: id, isRead, readAt: isRead ? daysFromNow(-1) : null, createdAt: daysFromNow(-i - 0.5) },
    });
  }
}
