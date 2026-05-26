import { Injectable, OnModuleDestroy } from "@nestjs/common";
import mysql, { Pool } from "mysql2/promise";

import { envs } from "../configs/envs";

@Injectable()
export class MysqlService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    this.pool = mysql.createPool({
      host: envs.DB_HOST,
      port: envs.DB_PORT,
      user: envs.DB_USERNAME,
      password: envs.DB_PASSWORD,
      database: envs.DB_DATABASE,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [rows] = await this.pool.query(sql, params);
    return rows as T[];
  }

  async queryOne<T>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? undefined;
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
