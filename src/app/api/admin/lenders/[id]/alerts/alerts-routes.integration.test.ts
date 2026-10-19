import { afterAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/admin/lenders/[id]/alerts/route";
import { GET as GET_NOTIFICATIONS } from "@/app/api/notifications/route";
import { GET as GET_AUDIT } from "@/app/api/audit-logs/route";
import { createTestLenderWithoutCompany, createTestUserWithPassword, createTestUserWithTwoFactor, issueAccessTokenFor, resetPhase1Tables } from "@/db/testFixtures";

const PASSWORD = "AdminClave123!";

const req = (method: string, url: string, headers: Record<string, string>, body?: unknown) =>
  new Request(url, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("AB-10 alerta al lender, AB-14 filtros de audit-logs, AB-15 notificaciones de ADMIN", () => {
  afterAll(resetPhase1Tables);

  it("ADMIN con 2FA envía la alerta, el lender la ve, y queda en auditoría filtrable por actorId/from/to", async () => {
    const { user: admin, secret } = await createTestUserWithTwoFactor("ADMIN", PASSWORD);
    const adminAuth = { authorization: `Bearer ${await issueAccessTokenFor(admin, PASSWORD, secret)}` };
    const { lenderUser, lenderProfile } = await createTestLenderWithoutCompany();
    const ctx = { params: Promise.resolve({ id: lenderProfile.id }) };
    const url = "http://localhost/api/admin/lenders/x/alerts";

    expect((await POST(req("POST", url, adminAuth, { title: "" }), ctx)).status).toBe(400);
    const sent = await POST(req("POST", url, adminAuth, { title: "Docs missing", body: "Upload your license." }), ctx);
    expect(sent.status).toBe(201);
    expect((await sent.json()).data).toMatchObject({ userId: lenderUser.id, type: "ADMIN_ALERT" });

    const lender = await createTestUserWithPassword("LENDER", PASSWORD);
    expect((await POST(req("POST", url, { authorization: `Bearer ${await issueAccessTokenFor(lender, PASSWORD)}` }, { title: "t", body: "b" }), ctx)).status).toBe(403);

    // AB-15: ADMIN puede listar notificaciones (vacío: no se le generan).
    const adminNotifications = await GET_NOTIFICATIONS(req("GET", "http://localhost/api/notifications", adminAuth));
    expect(adminNotifications.status).toBe(200);
    expect((await adminNotifications.json()).data.total).toBe(0);

    const audit = async (qs: string) => (await (await GET_AUDIT(req("GET", `http://localhost/api/audit-logs${qs}`, adminAuth))).json()).data;
    const day = 86_400_000;
    const iso = (offset: number) => encodeURIComponent(new Date(Date.now() + offset).toISOString());
    expect((await audit(`?action=LENDER_ALERT_SENT&actorId=${admin.id}`)).total).toBe(1);
    expect((await audit(`?action=LENDER_ALERT_SENT&actorId=${lenderUser.id}`)).total).toBe(0);
    expect((await audit(`?action=LENDER_ALERT_SENT&from=${iso(-day)}&to=${iso(day)}`)).total).toBe(1);
    expect((await audit(`?action=LENDER_ALERT_SENT&from=${iso(day)}`)).total).toBe(0);
    expect((await GET_AUDIT(req("GET", "http://localhost/api/audit-logs?from=nope", adminAuth))).status).toBe(400);
  });
});
