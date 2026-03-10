import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const nodeEnv = config.get<string>("NODE_ENV") ?? "development";
        const isTest = nodeEnv === "test";
        const dbDriver = config.get<string>("DATABASE_DRIVER");

        if (isTest && dbDriver !== "postgres") {
          return {
            type: "sqljs",
            location: ":memory:",
            autoSave: false,
            synchronize: true,
            autoLoadEntities: true,
            logging: false,
          } as const;
        }

        const sslEnabled = config.get<boolean>("DATABASE_SSL") ?? false;

        return {
          type: "postgres",
          host: config.get<string>("DATABASE_HOST"),
          port: config.get<number>("DATABASE_PORT"),
          username: config.get<string>("DATABASE_USERNAME"),
          password: config.get<string>("DATABASE_PASSWORD"),
          database: config.get<string>("DATABASE_NAME"),
          ssl: sslEnabled ? { rejectUnauthorized: false } : false,
          synchronize: nodeEnv !== "production",
          autoLoadEntities: true,
          logging: false,
        } as const;
      },
    }),
  ],
})
export class DatabaseModule {}
