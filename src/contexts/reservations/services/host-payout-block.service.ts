import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, IsNull, LessThanOrEqual, Repository } from "typeorm";

import { HostPayoutFailureEntity } from "../../payments/entities/host-payout-failure.entity";
import { PlatformSettingsService } from "../../payments/services/platform-settings.service";
import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";
import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationEmailService } from "./reservation-email.service";
import { ReservationEventService } from "./reservation-event.service";

export const HOST_PAYOUT_BLOCK_REASON = {
  TRANSFER_FAILED: "transfer_failed",
  BANK_PAYOUT_FAILED: "bank_payout_failed",
} as const;

export type HostPayoutBlockReason =
  (typeof HOST_PAYOUT_BLOCK_REASON)[keyof typeof HOST_PAYOUT_BLOCK_REASON];

export interface HostPayoutBlock {
  blocked: boolean;
  reason: HostPayoutBlockReason | null;
  /** Earliest unresolved failure that triggered the block (ISO). */
  since: string | null;
  /** platform_settings.payout_failure_days used for the check. */
  days: number;
  /** Reservations whose transfer keeps failing (reason transfer_failed). */
  reservation_ids: number[];
}

export interface BankPayoutFailureInput {
  stripeAccountId: string;
  userId: number | null;
  stripePayoutId: string;
  amountCents: number;
  currency: string;
  failureCode: string | null;
  failureMessage: string | null;
  failedAt: Date;
}

interface HostSiteRow {
  id: number;
  user_id: number;
  name: string | null;
  email: string | null;
}

interface FailingTransferRow {
  reservation_id: number;
  site_id: number;
  first_failed_at: Date | string;
}

/** reservation_events written by ReservationPayoutService.notifyPayoutFailed. */
export const PAYOUT_FAILED_EVENT = "payout_failed";
/** Written once per reservation when the 7-day escalation email went out. */
export const PAYOUT_FAILURE_ESCALATED_EVENT = "payout_failure_escalated";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Punto 9 del contrato: a host whose payout keeps failing for
 * payout_failure_days (default 7) cannot take NEW reservations until it is
 * fixed. Nothing is stored on the reservation: the block is computed from
 *  (a) reservations still held without transfer whose FIRST payout_failed
 *      event is older than the threshold (the 15-min cron keeps retrying;
 *      a successful transfer sets stripe_transfer_id and lifts it), and
 *  (b) unresolved host_payout_failures (Stripe payout.failed on the host
 *      account) older than the threshold (payout.paid lifts it).
 */
@Injectable()
export class HostPayoutBlockService {
  private readonly logger = new Logger(HostPayoutBlockService.name);

  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(HostPayoutFailureEntity)
    private readonly failureRepository: Repository<HostPayoutFailureEntity>,
    private readonly mysqlService: MysqlService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly reservationEmailService: ReservationEmailService,
    private readonly reservationEventService: ReservationEventService,
  ) {}

  async getHostPayoutBlock(
    hostUserId: number,
    now: Date = new Date(),
  ): Promise<HostPayoutBlock> {
    const days = await this.platformSettings.get("payout_failure_days");
    const threshold = new Date(now.getTime() - days * DAY_MS);
    const none: HostPayoutBlock = {
      blocked: false,
      reason: null,
      since: null,
      days,
      reservation_ids: [],
    };
    if (!hostUserId) {
      return none;
    }

    const sites = await this.hostSites(hostUserId);
    const failing = await this.failingTransfers(
      sites.map(site => site.id),
      threshold,
    );
    if (failing.length > 0) {
      const since = failing
        .map(row => new Date(row.first_failed_at))
        .reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
      return {
        blocked: true,
        reason: HOST_PAYOUT_BLOCK_REASON.TRANSFER_FAILED,
        since: since.toISOString(),
        days,
        reservation_ids: failing.map(row => Number(row.reservation_id)),
      };
    }

    const bank = await this.failureRepository.findOne({
      where: {
        user_id: hostUserId,
        resolved_at: IsNull(),
        failed_at: LessThanOrEqual(threshold),
      },
      order: { failed_at: "ASC" },
    });
    if (bank) {
      return {
        blocked: true,
        reason: HOST_PAYOUT_BLOCK_REASON.BANK_PAYOUT_FAILED,
        since: bank.failed_at.toISOString(),
        days,
        reservation_ids: [],
      };
    }
    return none;
  }

  /**
   * payout.failed (webhook transaction). Idempotent per Stripe payout: a
   * redelivery keeps the first failed_at so the 7-day clock never restarts.
   * Returns true when the row is new (the caller sends the emails).
   */
  async recordBankPayoutFailure(
    manager: EntityManager,
    input: BankPayoutFailureInput,
  ): Promise<boolean> {
    const repository = manager.getRepository(HostPayoutFailureEntity);
    const existing = await repository.findOne({
      where: { stripe_payout_id: input.stripePayoutId },
    });
    if (existing) {
      return false;
    }
    await repository.save(
      repository.create({
        stripe_account_id: input.stripeAccountId,
        user_id: input.userId,
        stripe_payout_id: input.stripePayoutId,
        amount_cents: input.amountCents,
        currency: input.currency,
        failure_code: input.failureCode,
        failure_message: input.failureMessage,
        failed_at: input.failedAt,
      }),
    );
    return true;
  }

  /** payout.paid (webhook transaction): every open failure of the account is resolved. */
  async resolveBankPayoutFailures(
    manager: EntityManager,
    stripeAccountId: string,
    resolvedAt: Date,
  ): Promise<number> {
    const result = await manager
      .getRepository(HostPayoutFailureEntity)
      .update(
        { stripe_account_id: stripeAccountId, resolved_at: IsNull() },
        { resolved_at: resolvedAt },
      );
    return result.affected ?? 0;
  }

  /** After commit of payout.failed: host + admin emails (never throws). */
  async notifyBankPayoutFailed(input: BankPayoutFailureInput): Promise<void> {
    try {
      const days = await this.platformSettings.get("payout_failure_days");
      const sites = input.userId ? await this.hostSites(input.userId) : [];
      const payload = {
        host_user_id: input.userId ?? 0,
        host_email: this.hostEmail(sites),
        site_names: this.siteNames(sites),
        amount_cents: input.amountCents,
        currency: input.currency,
        failure_message: input.failureMessage ?? input.failureCode,
        days,
      };
      if (payload.host_email !== "") {
        await this.reservationEmailService.sendHostNoticeEmail(
          "payout_bank_failed_host",
          payload,
        );
      }
      await this.reservationEmailService.sendHostNoticeEmail(
        "payout_bank_failed_admin",
        payload,
      );
    } catch (error) {
      this.logger.warn(
        `Could not notify bank payout failure ${input.stripePayoutId}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Daily: hosts that just crossed payout_failure_days get ONE "reservations
   * paused" email (host + admin). Marks: reservation event
   * payout_failure_escalated (transfers) / escalated_at (bank failures).
   */
  @Cron("0 9 * * *")
  async escalateBlockedHosts(now: Date = new Date()): Promise<void> {
    try {
      const days = await this.platformSettings.get("payout_failure_days");
      const threshold = new Date(now.getTime() - days * DAY_MS);
      await this.escalateFailingTransfers(threshold, days);
      await this.escalateBankFailures(threshold, days, now);
    } catch (error) {
      this.logger.error(
        "Payout failure escalation failed",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async escalateFailingTransfers(
    threshold: Date,
    days: number,
  ): Promise<void> {
    const rows = await this.failingTransfers(null, threshold, true);
    if (rows.length === 0) {
      return;
    }
    const siteIds = [...new Set(rows.map(row => Number(row.site_id)))];
    const sites = await this.sitesByIds(siteIds);
    const byHost = new Map<number, number[]>();
    for (const row of rows) {
      const site = sites.find(candidate => candidate.id === Number(row.site_id));
      const hostUserId = Number(site?.user_id ?? 0);
      if (!hostUserId) {
        continue;
      }
      const list = byHost.get(hostUserId) ?? [];
      list.push(Number(row.reservation_id));
      byHost.set(hostUserId, list);
    }

    for (const [hostUserId, reservationIds] of byHost) {
      const hostSites = await this.hostSites(hostUserId);
      await this.sendBlockedEmails(
        hostUserId,
        hostSites,
        HOST_PAYOUT_BLOCK_REASON.TRANSFER_FAILED,
        days,
        reservationIds,
      );
      for (const reservationId of reservationIds) {
        await this.reservationEventService.logEvent(
          reservationId,
          PAYOUT_FAILURE_ESCALATED_EVENT,
          { days },
        );
      }
    }
  }

  private async escalateBankFailures(
    threshold: Date,
    days: number,
    now: Date,
  ): Promise<void> {
    const rows = await this.failureRepository.find({
      where: {
        resolved_at: IsNull(),
        escalated_at: IsNull(),
        failed_at: LessThanOrEqual(threshold),
      },
    });
    const byHost = new Map<number, HostPayoutFailureEntity[]>();
    for (const row of rows) {
      const hostUserId = Number(row.user_id ?? 0);
      const list = byHost.get(hostUserId) ?? [];
      list.push(row);
      byHost.set(hostUserId, list);
    }
    for (const [hostUserId, failures] of byHost) {
      const hostSites = hostUserId ? await this.hostSites(hostUserId) : [];
      await this.sendBlockedEmails(
        hostUserId,
        hostSites,
        HOST_PAYOUT_BLOCK_REASON.BANK_PAYOUT_FAILED,
        days,
        [],
        failures[0]?.failure_message ?? failures[0]?.failure_code ?? null,
      );
      await this.failureRepository.update(
        failures.map(failure => failure.id),
        { escalated_at: now },
      );
    }
  }

  private async sendBlockedEmails(
    hostUserId: number,
    sites: HostSiteRow[],
    reason: HostPayoutBlockReason,
    days: number,
    reservationIds: number[],
    failureMessage: string | null = null,
  ): Promise<void> {
    const payload = {
      host_user_id: hostUserId,
      host_email: this.hostEmail(sites),
      site_names: this.siteNames(sites),
      reason,
      days,
      reservation_ids: reservationIds,
      failure_message: failureMessage,
    };
    if (payload.host_email !== "") {
      await this.reservationEmailService.sendHostNoticeEmail(
        "payout_blocked_host",
        payload,
      );
    }
    await this.reservationEmailService.sendHostNoticeEmail(
      "payout_blocked_admin",
      payload,
    );
  }

  /**
   * Reservations held without transfer whose first payout_failed event is
   * older than `threshold`. `siteIds` null = every site (escalation cron);
   * `onlyNotEscalated` skips reservations already escalated.
   */
  private async failingTransfers(
    siteIds: number[] | null,
    threshold: Date,
    onlyNotEscalated = false,
  ): Promise<FailingTransferRow[]> {
    if (siteIds !== null && siteIds.length === 0) {
      return [];
    }
    const params: unknown[] = [PAYOUT_FAILED_EVENT];
    let sql = `SELECT r.id AS reservation_id, r.site_id AS site_id, MIN(e.created_at) AS first_failed_at
      FROM reservations r
      INNER JOIN reservation_events e
        ON e.reservation_id = r.id AND e.event_type = ?
      WHERE r.payout_status = 'held' AND r.stripe_transfer_id IS NULL`;
    if (siteIds !== null) {
      sql += ` AND r.site_id IN (${siteIds.map(() => "?").join(", ")})`;
      params.push(...siteIds);
    }
    if (onlyNotEscalated) {
      sql += ` AND NOT EXISTS (SELECT 1 FROM reservation_events x
        WHERE x.reservation_id = r.id AND x.event_type = ?)`;
      params.push(PAYOUT_FAILURE_ESCALATED_EVENT);
    }
    sql += ` GROUP BY r.id, r.site_id HAVING MIN(e.created_at) <= ?`;
    params.push(threshold);
    return this.reservationRepository.query(sql, params);
  }

  private async hostSites(hostUserId: number): Promise<HostSiteRow[]> {
    return this.mysqlService.query<HostSiteRow>(
      `SELECT id, user_id, name, email FROM ${envs.DB_PREFIX}sites1 WHERE user_id = ? ORDER BY id ASC`,
      [hostUserId],
    );
  }

  private async sitesByIds(siteIds: number[]): Promise<HostSiteRow[]> {
    if (siteIds.length === 0) {
      return [];
    }
    return this.mysqlService.query<HostSiteRow>(
      `SELECT id, user_id, name, email FROM ${envs.DB_PREFIX}sites1 WHERE id IN (${siteIds.map(() => "?").join(", ")})`,
      siteIds,
    );
  }

  private hostEmail(sites: HostSiteRow[]): string {
    const site = sites.find(row => String(row.email ?? "").trim() !== "");
    return String(site?.email ?? "").trim();
  }

  private siteNames(sites: HostSiteRow[]): string[] {
    return sites
      .map(row => String(row.name ?? "").trim())
      .filter(name => name !== "");
  }
}
