import "reflect-metadata";

import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";

import { AppModule } from "./app.module";
import { HttpLoggingInterceptor } from "./common/interceptors/http-logging.interceptor";
import { RequestIdInterceptor } from "./common/interceptors/request-id.interceptor";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  });

  app.useGlobalInterceptors(new RequestIdInterceptor(), new HttpLoggingInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: true,
    }),
  );

  const config = app.get(ConfigService);
  const port = config.get<number>("PORT") ?? 3000;

  await app.listen(port, "0.0.0.0");
  Logger.log(`Listening on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
