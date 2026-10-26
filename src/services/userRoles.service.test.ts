import { describe, expect, it } from "vitest";
import { activeRolesOf } from "./userRoles.service";

const alive = { deletedAt: null };
const gone = { deletedAt: new Date() };

describe("activeRolesOf", () => {
  it("agrega el rol adquirido de un usuario dual", () => {
    expect(activeRolesOf({ role: "LENDER", lenderProfile: alive, borrowerProfile: alive }).sort()).toEqual(["BORROWER", "LENDER"]);
  });
  it("ignora perfiles borrados y conserva el rol de registro", () => {
    expect(activeRolesOf({ role: "BORROWER", lenderProfile: gone, borrowerProfile: null })).toEqual(["BORROWER"]);
  });
  it("staff no combina roles", () => {
    expect(activeRolesOf({ role: "ADMIN", lenderProfile: alive, borrowerProfile: alive })).toEqual(["ADMIN"]);
  });
});
