import { config } from "dotenv";
import { DataSource, DataSourceOptions } from "typeorm";

config();

export const dataSourceConfig: DataSourceOptions = {
  type: "postgres",
  url: process.env.DATABASE_MIGRATIONS_URL,
  entities: [__dirname + "/../**/*.entity{.ts,.js}"],
  migrations: [__dirname + "/../database/migrations/**/*{.ts,.js}"],
  synchronize: false,
  logging: false,
};

export const dataSource = new DataSource(dataSourceConfig);
