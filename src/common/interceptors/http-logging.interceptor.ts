import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { catchError, tap } from "rxjs/operators";

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
      requestId?: string;
    }>();

    const method = req.method ?? "UNKNOWN_METHOD";
    const path = req.originalUrl ?? req.url ?? "";
    const requestId = req.requestId ?? "unknown";

    const start = process.hrtime.bigint();

    return next.handle().pipe(
      tap(() => {
        const res = http.getResponse<{ statusCode?: number }>();
        const statusCode = res.statusCode ?? 0;
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

        this.logger.log(
          `${method} ${path} -> ${statusCode} ${durationMs.toFixed(1)}ms (${requestId})`,
        );
      }),
      catchError((err) => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        this.logger.error(
          `${method} ${path} -> ERROR ${durationMs.toFixed(1)}ms (${requestId})`,
          err?.stack,
        );
        throw err;
      }),
    );
  }
}
