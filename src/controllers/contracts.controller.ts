import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import * as contractFeesService from "@/services/contractFees.service";
import * as contractsService from "@/services/contracts.service";
import { getRequestMeta } from "@/lib/requestMeta";
import { parseOrThrow } from "@/validations/parse";
import {
  addContractBorrowerSchema,
  cancelContractSchema,
  createContractSchema,
  createFeeItemSchema,
  listContractsQuerySchema,
  proposeContractTermsSchema,
  rejectContractTermsSchema,
  updateContractSchema,
} from "@/validations/contracts.validation";

// Fase 6: /api/contracts/** — LENDER, escrituras exigen 2FA (D-P3-1); las
// acciones de BORROWER (accept/reject/lecturas) nunca lo requieren
// (TWO_FACTOR_ROLES en withRole.ts no incluye BORROWER, el flag es inerte
// ahí, pero se pasa explícito por claridad).
async function requireLenderSession(request: Request, options?: { requireTwoFactor?: boolean }) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER"], options);
  return session;
}

async function requireBorrowerSession(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["BORROWER"], { requireTwoFactor: false });
  return session;
}

async function requireLenderOrBorrowerSession(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER", "BORROWER"], { requireTwoFactor: false });
  return session;
}

// BE-051.
export async function createContract(request: Request, body: unknown) {
  const session = await requireLenderSession(request);
  const input = parseOrThrow(createContractSchema, body);
  return contractsService.createContract(session.userId, input);
}

// BE-052.
export async function listContracts(request: Request, query: unknown) {
  const session = await requireLenderOrBorrowerSession(request);
  const input = parseOrThrow(listContractsQuerySchema, query);
  return contractsService.listContracts(session, input);
}

// BE-053.
export async function getContract(request: Request, id: string) {
  const session = await requireLenderOrBorrowerSession(request);
  return contractsService.getContract(session, id);
}

// BE-054.
export async function updateContract(request: Request, id: string, body: unknown) {
  const session = await requireLenderSession(request);
  const input = parseOrThrow(updateContractSchema, body);
  return contractsService.updateContract(session.userId, id, input);
}

// BE-055.
export async function deleteContract(request: Request, id: string) {
  const session = await requireLenderSession(request);
  await contractsService.deleteContract(session.userId, id);
  return { deleted: true };
}

// BE-056.
export async function cancelContract(request: Request, id: string, body: unknown) {
  const session = await requireLenderSession(request);
  const input = parseOrThrow(cancelContractSchema, body);
  return contractsService.cancelContract(session.userId, id, input);
}

// BE-057.
export async function addContractBorrower(request: Request, id: string, body: unknown) {
  const session = await requireLenderSession(request);
  const input = parseOrThrow(addContractBorrowerSchema, body);
  return contractsService.addContractBorrower(session.userId, id, input);
}

export async function removeContractBorrower(request: Request, id: string, borrowerId: string) {
  const session = await requireLenderSession(request);
  await contractsService.removeContractBorrower(session.userId, id, borrowerId);
  return { removed: true };
}

// BE-060 (historial + crear).
export async function listContractTerms(request: Request, id: string) {
  const session = await requireLenderOrBorrowerSession(request);
  return contractsService.listContractTermsHistory(session, id);
}

export async function proposeContractTerms(request: Request, id: string, body: unknown) {
  const session = await requireLenderSession(request);
  const input = parseOrThrow(proposeContractTermsSchema, body);
  return contractsService.proposeContractTerms(session.userId, id, input);
}

// BE-060 (submit).
export async function submitContractTerms(request: Request, id: string, termsId: string) {
  const session = await requireLenderSession(request);
  return contractsService.submitContractTerms(session.userId, id, termsId);
}

// BE-061.
export async function acceptContractTerms(request: Request, id: string, termsId: string) {
  const session = await requireBorrowerSession(request);
  return contractsService.acceptContractTerms(session.userId, id, termsId, getRequestMeta(request));
}

export async function rejectContractTerms(request: Request, id: string, termsId: string, body: unknown) {
  const session = await requireBorrowerSession(request);
  const input = parseOrThrow(rejectContractTermsSchema, body);
  return contractsService.rejectContractTerms(session.userId, id, termsId, input, getRequestMeta(request));
}

// BE-062.
export async function getSchedule(request: Request, id: string) {
  const session = await requireLenderOrBorrowerSession(request);
  return contractsService.getSchedule(session, id);
}

export async function getBalance(request: Request, id: string) {
  const session = await requireLenderOrBorrowerSession(request);
  return contractsService.getBalance(session, id);
}

// PB-020.
export async function listFees(request: Request, id: string, termsId: string) {
  const session = await requireLenderOrBorrowerSession(request);
  return contractFeesService.listFees(session, id, termsId);
}

export async function addFee(request: Request, id: string, termsId: string, body: unknown) {
  const session = await requireLenderSession(request);
  const input = parseOrThrow(createFeeItemSchema, body);
  return contractFeesService.addFee(session.userId, id, termsId, input);
}

export async function deleteFee(request: Request, id: string, termsId: string, feeId: string) {
  const session = await requireLenderSession(request);
  await contractFeesService.deleteFee(session.userId, id, termsId, feeId);
  return { removed: true };
}
