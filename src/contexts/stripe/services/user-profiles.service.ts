import { Injectable, NotFoundException } from "@nestjs/common";

import { UserProfile } from "@/src/types/user-profile.types";

import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";

@Injectable()
export class UserProfilesService {
  constructor(private readonly mysqlService: MysqlService) {}

  private tableName() {
    return `${envs.DB_PREFIX}user_profiles`;
  }

  async findById(userId: number): Promise<UserProfile | undefined> {
    return this.mysqlService.queryOne<UserProfile>(
      `SELECT id, email, name, role, stripe_account_id FROM ${this.tableName()} WHERE id = ?`,
      [userId],
    );
  }

  async findByStripeAccountId(
    stripeAccountId: string,
  ): Promise<UserProfile | undefined> {
    return this.mysqlService.queryOne<UserProfile>(
      `SELECT id, email, name, role, stripe_account_id FROM ${this.tableName()} WHERE stripe_account_id = ?`,
      [stripeAccountId],
    );
  }

  async saveStripeAccountId(
    userId: number,
    stripeAccountId: string,
  ): Promise<UserProfile> {
    const profile = await this.findById(userId);
    if (!profile) {
      throw new NotFoundException(`User profile with id ${userId} not found`);
    }

    await this.mysqlService.query(
      `UPDATE ${this.tableName()} SET stripe_account_id = ? WHERE id = ?`,
      [stripeAccountId, userId],
    );

    return {
      ...profile,
      stripe_account_id: stripeAccountId,
    };
  }
}
