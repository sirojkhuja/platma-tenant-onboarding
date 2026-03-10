import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Observable } from "rxjs";

export const REQUEST_ID_HEADER = "x-request-id";

function coerceHeaderValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.filter((v) => typeof v === "string").join(",") || undefined;
  return undefined;
}

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<any>();
    const res = http.getResponse<any>();

    const fromHeader = coerceHeaderValue(req?.headers?.[REQUEST_ID_HEADER]);
    const requestId = (fromHeader && fromHeader.trim()) || randomUUID();

    if (req) req.requestId = requestId;

    if (res) {
      if (typeof res.header === "function") res.header(REQUEST_ID_HEADER, requestId);
      else if (typeof res.setHeader === "function") res.setHeader(REQUEST_ID_HEADER, requestId);
    }

    return next.handle();
  }
}
