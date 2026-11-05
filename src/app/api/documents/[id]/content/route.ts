import { getDocumentContent } from "@/controllers/documents.controller";
import { handleRouteError } from "@/errors/errorHandler";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/documents/:id/content — archivo ya descifrado (PB-002).
// `?download=1` lo baja como adjunto en vez de mostrarlo en el navegador.
export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const { body, mimeType, fileName } = await getDocumentContent(request, id);
    const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
    return new Response(new Uint8Array(body), {
      headers: {
        "content-type": mimeType,
        "content-length": String(body.length),
        "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return handleRouteError(error, request);
  }
}
