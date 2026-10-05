// Genera la colección de Bruno (./bruno) a partir de src/app/api/**/route.ts
// y los schemas Zod de src/validations. Regenerar: pnpm exec tsx scripts/gen-bruno.ts
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import * as validations from "./validations-barrel";

const API = path.resolve("src/app/api");
const OUT = path.resolve("bruno");
const PUBLIC = new Set([
  "GET /health", "POST /auth/register", "POST /auth/login", "POST /auth/login/2fa",
  "POST /auth/refresh", "POST /auth/password/forgot", "POST /auth/password/reset",
  "GET /lenders/:lenderCompanyId/rating",
]);

// "METHOD /ruta" -> schema (body para POST/PATCH/DELETE, query para GET)
const S: Record<string, string> = {
  "POST /users": "createUserSchema", "PATCH /users/:id": "updateUserSchema",
  "POST /auth/register": "registerSchema", "POST /auth/login": "loginSchema",
  "POST /auth/login/2fa": "loginTwoFactorSchema", "POST /auth/refresh": "refreshSchema",
  "POST /auth/logout": "logoutSchema", "PATCH /auth/me": "updateMeSchema",
  "POST /auth/password/forgot": "passwordForgotSchema", "POST /auth/password/reset": "passwordResetSchema",
  "POST /auth/2fa/verify": "twoFactorVerifySchema", "POST /auth/2fa/disable": "twoFactorStepUpSchema",
  "POST /auth/2fa/recovery-codes": "twoFactorStepUpSchema",
  "POST /admin/lenders/:id/companies": "createLenderCompanySchema",
  "PATCH /admin/lenders/:id/companies/:companyId": "updateLenderCompanySchema",
  "GET /admin/lenders": "listLendersQuerySchema",
  "POST /lenders/me/companies": "createLenderCompanySchema",
  "PATCH /lenders/me/companies/:companyId": "updateOwnLenderCompanySchema",
  "POST /lenders/me/become-borrower": "becomeBorrowerSchema",
  "POST /lenders/me/borrowers": "createBorrowerSchema",
  "PATCH /lenders/me/borrowers/:id": "updateBorrowerProfileSchema",
  "GET /lenders/me/borrowers": "listBorrowersQuerySchema",
  "PATCH /borrowers/me": "updateBorrowerProfileSchema",
  "POST /borrowers/me/become-lender": "createLenderCompanySchema",
  "POST /borrowers/me/password": "changePasswordSchema",
  "POST /contracts": "createContractSchema", "GET /contracts": "listContractsQuerySchema",
  "PATCH /contracts/:id": "updateContractSchema", "POST /contracts/:id/cancel": "cancelContractSchema",
  "POST /contracts/:id/borrowers": "addContractBorrowerSchema",
  "POST /contracts/:id/terms": "proposeContractTermsSchema",
  "POST /contracts/:id/terms/:termsId/reject": "rejectContractTermsSchema",
  "POST /contracts/:id/terms/:termsId/fees": "createFeeItemSchema",
  "POST /contracts/:id/payments/manual": "createManualPaymentSchema",
  "GET /contracts/:id/transactions": "listTransactionsQuerySchema",
  "POST /transactions/:id/reverse": "reverseTransactionSchema",
  "GET /audit-logs": "listAuditLogsQuerySchema",
  "POST /contracts/:id/reviews": "createReviewSchema",
  "GET /lenders/:lenderCompanyId/rating": "paginationQuerySchema",
  "GET /borrowers/:borrowerProfileId/rating": "paginationQuerySchema",
  "POST /lenders/me/companies/:companyId/verification": "submitVerificationSchema",
  "POST /borrowers/me/verification": "submitVerificationSchema",
  "GET /admin/verifications": "listVerificationsQuerySchema",
  "POST /admin/verifications/:id/reject": "rejectVerificationSchema",
  "POST /borrowers/me/loan-requests": "createLoanRequestSchema",
  "GET /borrowers/me/loan-requests": "listLoanRequestsQuerySchema",
  "PATCH /borrowers/me/loan-requests/:id": "updateLoanRequestSchema",
  "POST /borrowers/me/loan-requests/:id/targets": "addLoanRequestTargetSchema",
  "GET /marketplace/loan-requests": "listLoanRequestsQuerySchema",
  "POST /marketplace/loan-requests/:id/quotes": "submitLoanQuoteSchema",
  "POST /lenders/me/messages": "sendMessageAsLenderSchema",
  "POST /borrowers/me/messages": "sendMessageAsBorrowerSchema",
  "GET /lenders/me/messages/threads/:borrowerProfileId": "lenderThreadQuerySchema",
  "GET /borrowers/me/messages/threads/:lenderCompanyId": "paginationQuerySchema",
  "POST /lenders/me/messages/threads/:borrowerProfileId/read": "markThreadReadQuerySchema",
  "POST /borrowers/me/messages/threads/:lenderCompanyId/read": "markThreadReadQuerySchema",
  "GET /notifications": "listNotificationsQuerySchema",
};
// Rutas POST cuyo schema va en query string, no en body
const IN_QUERY = new Set(["POST /lenders/me/messages/threads/:borrowerProfileId/read", "POST /borrowers/me/messages/threads/:lenderCompanyId/read"]);

const PARAM_VAR: Record<string, (p: string) => string> = {
  id: (r) => ({ contracts: "contractId", users: "userId", lenders: "lenderId", verifications: "verificationId",
    transactions: "transactionId", notifications: "notificationId", "loan-requests": "loanRequestId",
    borrowers: "borrowerId" } as Record<string, string>)[r.match(/(contracts|users|lenders|verifications|transactions|notifications|loan-requests|borrowers)\/:id/)?.[1] ?? ""] ?? "id",
};
const varFor = (name: string, route: string) => (PARAM_VAR[name]?.(route) ?? name);

function example(s: any, key = ""): unknown {
  if (!s || typeof s !== "object") return "";
  if ("const" in s) return s.const;
  if ("default" in s) return s.default;
  if (s.enum) return s.enum[0];
  if (!s.type && /date/i.test(key)) return new Date(Date.now() + (/maturity/i.test(key) ? 365 * 864e5 : 0)).toISOString().slice(0, 10); // z.coerce.date()
  if (s.anyOf || s.oneOf) return example((s.anyOf ?? s.oneOf)[0], key);
  if (s.allOf) return Object.assign({}, ...s.allOf.map((x: any) => example(x, key)));
  switch (s.type) {
    case "string":
      if (s.format === "email") return "user@example.com";
      if (s.format === "date-time") return new Date().toISOString();
      if (s.format === "date") return new Date().toISOString().slice(0, 10);
      if (s.format === "uuid") return "00000000-0000-0000-0000-000000000000";
      if (s.pattern === "^\\d{10}$") return "5125550100";
      if (s.minLength === 2 && s.maxLength === 2) return "TX";
      if (/date$/i.test(key)) return new Date().toISOString().slice(0, 10);
      if (/cuid|Id$/.test(key)) return `{{${key}}}`;
      return key || "string";
    case "integer": case "number": return s.minimum ?? (s.exclusiveMinimum != null ? s.exclusiveMinimum + 1 : 1);
    case "boolean": return true;
    case "array": return [example(s.items, key)];
    case "object": {
      const req = new Set<string>(s.required ?? []);
      return Object.fromEntries(Object.entries<any>(s.properties ?? {}).filter(([k]) => req.has(k)).map(([k, v]) => [k, example(v, k)]));
    }
    default: return "";
  }
}
const toJson = (name: string) => z.toJSONSchema((validations as any)[name], { io: "input", unrepresentable: "any" }) as any;

function scan(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? scan(p) : f === "route.ts" ? [p] : [];
  });
}
const SETTOKENS = `script:post-response {\n  if (res.body?.data?.accessToken) {\n    bru.setEnvVar("accessToken", res.body.data.accessToken);\n    bru.setEnvVar("refreshToken", res.body.data.refreshToken);\n  }\n}\n`;
const SAVE_ID: Record<string, string> = {
  "POST /contracts": "contractId", "POST /borrowers/me/loan-requests": "loanRequestId",
  "POST /contracts/:id/terms": "termsId",
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(OUT, "environments"), { recursive: true });
writeFileSync(path.join(OUT, "bruno.json"), JSON.stringify({ version: "1", name: "PayMyLoan API", type: "collection", ignore: ["node_modules", ".git"] }, null, 2) + "\n");
writeFileSync(path.join(OUT, "collection.bru"), `auth {\n  mode: bearer\n}\n\nauth:bearer {\n  token: {{accessToken}}\n}\n`);
const vars = ["contractId", "userId", "lenderId", "verificationId", "transactionId", "notificationId", "loanRequestId", "borrowerId",
  "companyId", "termsId", "feeId", "quoteId", "lenderCompanyId", "borrowerProfileId"];
writeFileSync(path.join(OUT, "environments/local.bru"),
  `vars {\n  baseUrl: http://localhost:4000\n  accessToken: \n  refreshToken: \n${vars.map((v) => `  ${v}: `).join("\n")}\n}\n`);

let n = 0;
const seq: Record<string, number> = {};
for (const file of scan(API).sort()) {
  const rel = "/" + path.relative(API, path.dirname(file)).split(path.sep).join("/");
  const route = rel.replace(/\[(\w+)\]/g, ":$1");
  const methods = [...readFileSync(file, "utf8").matchAll(/export (?:const|async function) (GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => m[1]);
  const segs = route.split("/").filter(Boolean);
  const folder = segs[0] === "admin" || segs[0] === "lenders" || segs[0] === "borrowers" ? `${segs[0]}${segs[1] === "me" ? "-me" : ""}` : segs[0];
  for (const method of methods) {
    const key = `${method} ${route}`;
    const dir = path.join(OUT, folder);
    mkdirSync(dir, { recursive: true });
    const params = [...route.matchAll(/:(\w+)/g)].map((m) => m[1]);
    const schemaName = S[key];
    const js = schemaName ? toJson(schemaName) : null;
    const asQuery = js && (method === "GET" || IN_QUERY.has(key));
    const hasBody = js && !asQuery;
    const name = `${method} ${route}`;
    const fname = name.replace(/[/:]/g, "_").replace(/_+/g, "_").replace(/ _/, " ") + ".bru";
    seq[folder] = (seq[folder] ?? 0) + 1;
    const urlPath = route.replace(/:(\w+)/g, ":$1");
    let out = `meta {\n  name: ${name}\n  type: http\n  seq: ${seq[folder]}\n}\n\n${method.toLowerCase()} {\n  url: {{baseUrl}}/api${urlPath}\n  body: ${hasBody ? "json" : "none"}\n  auth: ${PUBLIC.has(key) ? "none" : "inherit"}\n}\n`;
    if (asQuery) {
      const props = Object.entries<any>(js.properties ?? {});
      if (props.length) out += `\nparams:query {\n${props.map(([k, v]) => `  ~${k}: ${example(v, k)}`).join("\n")}\n}\n`;
    }
    if (params.length) out += `\nparams:path {\n${params.map((p) => `  ${p}: {{${varFor(p, route)}}}`).join("\n")}\n}\n`;
    if (hasBody) out += `\nbody:json {\n${JSON.stringify(example(js), null, 2).replace(/^/gm, "  ")}\n}\n`;
    if (/^POST \/auth\/(login|login\/2fa|refresh)$/.test(key)) out += `\n${SETTOKENS}`;
    else if (SAVE_ID[key]) out += `\nscript:post-response {\n  if (res.body?.data?.id) bru.setEnvVar("${SAVE_ID[key]}", res.body.data.id);\n}\n`;
    writeFileSync(path.join(dir, fname), out);
    n++;
  }
}
console.log(`${n} requests -> ${OUT}`);
