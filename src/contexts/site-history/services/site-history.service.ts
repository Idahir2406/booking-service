import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { FindOptionsWhere, LessThan, Repository } from "typeorm";

import { AdditionalServiceEntity } from "@/contexts/additional-services/entities/additional-service.entity";
import { DogSupplyEntity } from "@/contexts/dog-supplies/entities/dog-supply.entity";
import {
  AUDIT_ENTITY,
  AuditLogEntity,
} from "@/contexts/payments/entities/audit-log.entity";

import {
  buildSiteHistory,
  type SiteHistoryAudience,
  type SiteHistoryCatalogs,
  type SiteHistoryItem,
} from "../utils/site-history.util";

export const SITE_HISTORY_PAGE = { DEFAULT: 50, MAX: 200 } as const;

export interface SiteHistoryDto {
  site_id: number;
  items: SiteHistoryItem[];
  /** Pass as `before` to get the next (older) page; null = no more. */
  next_before: string | null;
}

export interface SiteHistoryQuery {
  limit?: number;
  /** audit_log id: only older rows. */
  before?: string;
}

/** Read-only accommodation change history (host panel + admino). */
@Injectable()
export class SiteHistoryService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditRepository: Repository<AuditLogEntity>,
    @InjectRepository(DogSupplyEntity)
    private readonly dogSupplyRepository: Repository<DogSupplyEntity>,
    @InjectRepository(AdditionalServiceEntity)
    private readonly additionalServiceRepository: Repository<AdditionalServiceEntity>,
  ) {}

  async get(
    siteId: number,
    audience: SiteHistoryAudience,
    query: SiteHistoryQuery = {},
  ): Promise<SiteHistoryDto> {
    const limit = Math.min(
      Math.max(Math.trunc(query.limit ?? SITE_HISTORY_PAGE.DEFAULT), 1),
      SITE_HISTORY_PAGE.MAX,
    );
    const where: FindOptionsWhere<AuditLogEntity> = {
      entity: AUDIT_ENTITY.SITE,
      entity_id: String(siteId),
    };
    if (query.before && /^\d+$/.test(query.before)) {
      where.id = LessThan(query.before);
    }
    const [rows, catalogs] = await Promise.all([
      this.auditRepository.find({
        where,
        order: { id: "DESC" },
        take: limit + 1,
      }),
      this.loadCatalogs(),
    ]);
    const page = rows.slice(0, limit);
    return {
      site_id: siteId,
      items: buildSiteHistory(page, audience, catalogs),
      next_before: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  private async loadCatalogs(): Promise<SiteHistoryCatalogs> {
    const [supplies, services] = await Promise.all([
      this.dogSupplyRepository.find({ select: { id: true, name: true } }),
      this.additionalServiceRepository.find({
        select: { id: true, name: true },
      }),
    ]);
    return {
      dog_supplies: new Map(supplies.map(row => [String(row.id), row.name])),
      additional_services: new Map(
        services.map(row => [String(row.id), row.name]),
      ),
    };
  }
}
