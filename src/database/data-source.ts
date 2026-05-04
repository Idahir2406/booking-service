import { DataSource, DataSourceOptions } from "typeorm";

export const dataSourceConfig: DataSourceOptions = {
  type: "postgres",
  entities: [__dirname + "/../**/*.entity{.ts,.js}"],
  migrations: [__dirname + "/../database/migrations/**/*{.ts,.js}"],
  synchronize: false,
  logging: false,
};

export const dataSource = new DataSource(dataSourceConfig);
