import { afterEach, describe, expect, it, vi } from "vitest";

describe("sendEmail (BE-006)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.doUnmock("@/config/env");
  });

  it("envía vía Resend con el HTML de la plantilla y responde ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("@/config/env", () => ({ env: { emailProvider: "resend", emailApiKey: "test-key", emailFrom: "servicing@paymyloan.ai" } }));
    vi.resetModules();

    const { sendEmail } = await import("@/lib/email");
    await sendEmail({
      to: "deudor@example.com",
      subject: "Restablecer contraseña",
      template: "password-reset",
      data: { resetUrl: "https://paymyloan.ai/reset/abc123" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(init.body as string);
    expect(body.to).toBe("deudor@example.com");
    expect(body.html).toContain("https://paymyloan.ai/reset/abc123");
  });

  it("propaga el error si Resend responde con status no-ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    vi.doMock("@/config/env", () => ({ env: { emailProvider: "resend", emailApiKey: "test-key", emailFrom: "servicing@paymyloan.ai" } }));
    vi.resetModules();

    const { sendEmail } = await import("@/lib/email");
    await expect(
      sendEmail({
        to: "deudor@example.com",
        subject: "x",
        template: "welcome-borrower",
        data: { name: "Ana", temporaryPassword: "temp123" },
      }),
    ).rejects.toThrow(/Resend respondió 500/);
  });

  it("lanza si EMAIL_PROVIDER no es soportado", async () => {
    vi.doMock("@/config/env", () => ({ env: { emailProvider: "unsupported", emailApiKey: "test-key" } }));
    vi.resetModules();

    const { sendEmail } = await import("@/lib/email");
    await expect(
      sendEmail({ to: "x@example.com", subject: "x", template: "password-reset", data: { resetUrl: "x" } }),
    ).rejects.toThrow(/no soportado/);
  });

  it("con EMAIL_API_KEY vacío, loguea en vez de llamar a Resend (D-P2-1, modo dev)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("@/config/env", () => ({ env: { emailProvider: "resend", emailApiKey: "" } }));
    vi.resetModules();

    const { sendEmail } = await import("@/lib/email");
    await expect(
      sendEmail({
        to: "lender@example.com",
        subject: "Tu cuenta ya está activa",
        template: "account-activated",
        data: { name: "Ana", temporaryPassword: "temp123" },
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
