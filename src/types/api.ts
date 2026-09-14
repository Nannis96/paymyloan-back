// Forma estándar de toda respuesta JSON de la API, para que cada endpoint
// nuevo devuelva algo predecible en vez de inventar su propio formato.

export interface ApiSuccessBody<T> {
  success: true;
  data: T;
}

export interface ApiErrorBody {
  success: false;
  error: {
    message: string;
    code: string;
  };
}

export type ApiBody<T> = ApiSuccessBody<T> | ApiErrorBody;
