import { afterAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/admin/borrowers/route";
import { GET as GET_CONTRACTS } from "@/app/api/contracts/route";
import { prisma } from "@/db/prisma";
import {
  createTestBorrower,
  createTestContract,
  createTestLenderCompany,
  createTestProperty,
  createTestUserWithPassword,
  issueAccessTokenFor,
  resetPhase1Tables,
} from "@/db/testFixtures";

const ADMIN_PASSWORD = "AdminClave123!";

describe("AB-02/AB-03/AB-04", () => {
  afterAll(resetPhase1Tables);

  it("GET /api/admin/borrowers lista, filtra por search/verification y cuenta contratos; solo ADMIN", async () => {
    const admin = await createTestUserWithPassword("ADMIN", ADMIN_PASSWORD);
    const auth = { authorization: `Bearer ${await issueAccessTokenFor(admin, ADMIN_PASSWORD)}` };
    const get = (qs = "", headers: Record<string, string> = auth) => GET(new Request(`http://localhost/api/admin/borrowers${qs}`, { headers }));

    const { borrowerProfile } = await createTestBorrower();
    await prisma.borrowerProfile.update({ where: { id: borrowerProfile.id }, data: { entityName: "Zeta Holdings LLC" } });
    await createTestBorrower();

    const all = (await (await get()).json()).data;
    expect(all.total).toBe(2);

    const found = (await (await get("?search=zeta")).json()).data;
    expect(found.total).toBe(1);
    expect(found.items[0]).toMatchObject({ id: borrowerProfile.id, entityName: "Zeta Holdings LLC", verification: null, contractsCount: 0 });

    expect((await (await get("?verification=PENDING")).json()).data.total).toBe(0);
    expect((await get("?verification=NOPE")).status).toBe(400);
    expect((await get("", {})).status).toBe(401);
  });

  it("GET /api/contracts?search= (ADMIN) filtra por número de contrato o dirección", async () => {
    const admin = await createTestUserWithPassword("ADMIN", ADMIN_PASSWORD);
    const auth = { authorization: `Bearer ${await issueAccessTokenFor(admin, ADMIN_PASSWORD)}` };
    const { lenderCompany } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, admin.id);
    const contract = await createTestContract({ lenderCompanyId: lenderCompany.id, propertyId: property.id, createdByUserId: admin.id });
    const get = async (qs: string) => (await (await GET_CONTRACTS(new Request(`http://localhost/api/contracts${qs}`, { headers: auth }))).json()).data;

    expect((await get(`?search=${contract.contractNumber}`)).total).toBe(1);
    expect((await get("?search=oak%20ave")).total).toBe(1);
    expect((await get("?search=zzz-no-match")).total).toBe(0);
    expect((await get("?search=oak&status=ACTIVE")).total).toBe(0);
  });
});
