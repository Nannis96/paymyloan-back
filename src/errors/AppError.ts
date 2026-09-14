// Error base para fallos esperados dentro de un caso de uso (validación,
// recurso no encontrado, no autorizado, etc.). Los servicios y controladores
// futuros lanzan AppError (o una subclase) en vez de un Error genérico, y
// errorHandler.ts sabe cómo convertirlo en la respuesta HTTP correcta.
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode = 500, code = "INTERNAL_ERROR") {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
