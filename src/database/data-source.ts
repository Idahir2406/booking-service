import { config } from "dotenv";
import { DataSource, DataSourceOptions } from "typeorm";

import { envs } from "../contexts/shared/configs/envs";

config();

export const dataSourceConfig: DataSourceOptions = {
  type: "mariadb",
  host: envs.DB_HOST,
  port: envs.DB_PORT,
  username: envs.DB_USERNAME,
  password: envs.DB_PASSWORD,
  database: envs.DB_DATABASE,
  entities: [__dirname + "/../**/*.entity{.ts,.js}"],
  migrations: [__dirname + "/../database/migrations/**/*{.ts,.js}"],
  synchronize: false,
  logging: false,
};

export const dataSource = new DataSource(dataSourceConfig);
