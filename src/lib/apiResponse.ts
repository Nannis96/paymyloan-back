import { NextResponse } from "next/server";
import type { ApiErrorBody, ApiSuccessBody } from "@/types/api";

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json<ApiSuccessBody<T>>({ success: true, data }, { status });
}

export function apiError(message: string, status = 500, code = "INTERNAL_ERROR") {
  return NextResponse.json<ApiErrorBody>(
    { success: false, error: { message, code } },
    { status },
  );
}
