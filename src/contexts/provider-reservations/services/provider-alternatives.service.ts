import type { ReservationEmailAlternative } from "../../reservations/types/reservation-email.types";

import { Injectable, Logger } from "@nestjs/common";

import { AccommodationProviderRegistry } from "../../providers/services/accommodation-provider.registry";
import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";

export const MAX_PROVIDER_ALTERNATIVES = 3;
/** Candidates checked for live availability (one searchRates call). */
const CANDIDATE_LIMIT = 10;

export interface AlternativesQuery {
  siteId: number;
  provider: string;
  checkin: string;
  checkout: string;
  adults: number;
  childrenAges: number[];
}

interface CandidateRow {
  id: number;
  name: string | null;
  alias_l1: string | null;
  provider_hotel_id: string;
}

export function publicSiteUrl(id: number, alias: string | null): string {
  const base = (envs.BOOKING_WEB_URL ?? envs.FRONTEND_URL).replace(/\/+$/, "");
  const slug = (alias ?? "").trim();
  return `${base}/alojamientos-admiten-perros/${id}${slug === "" ? "" : `-${slug}`}`;
}

/**
 * Up to 3 other ACTIVE provider sites in the same town (id_poblacion) for a
 * failed book email. Availability is checked live for the same stay; if the
 * provider call fails, the candidates are returned unchecked. Never throws.
 */
@Injectable()
export class ProviderAlternativesService {
  private readonly logger = new Logger(ProviderAlternativesService.name);

  constructor(
    private readonly mysqlService: MysqlService,
    private readonly registry: AccommodationProviderRegistry,
  ) {}

  async find(query: AlternativesQuery): Promise<ReservationEmailAlternative[]> {
    try {
      const prefix = envs.DB_PREFIX;
      const candidates = await this.mysqlService.query<CandidateRow>(
        `SELECT s.id, s.name, s.alias_l1, p.provider_hotel_id
           FROM ${prefix}sites1 s
           JOIN provider_properties p ON p.site_id = s.id
           JOIN ${prefix}sites1 origin ON origin.id = ?
          WHERE p.status = 'active'
            AND p.provider = ?
            AND s.id <> origin.id
            AND s.id_poblacion = origin.id_poblacion
          ORDER BY s.id ASC
          LIMIT ${CANDIDATE_LIMIT}`,
        [query.siteId, query.provider],
      );
      if (candidates.length === 0) {
        return [];
      }
      const available = await this.withAvailability(query, candidates);
      return available.slice(0, MAX_PROVIDER_ALTERNATIVES).map(row => ({
        name: row.name ?? "Alojamiento",
        url: publicSiteUrl(row.id, row.alias_l1),
      }));
    } catch (error) {
      this.logger.warn(
        `Alternatives unavailable for site ${query.siteId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private async withAvailability(
    query: AlternativesQuery,
    candidates: CandidateRow[],
  ): Promise<CandidateRow[]> {
    if (!this.registry.has(query.provider)) {
      return candidates;
    }
    try {
      const rates = await this.registry.get(query.provider).searchRates({
        hotelIds: candidates.map(row => row.provider_hotel_id),
        checkin: query.checkin,
        checkout: query.checkout,
        occupancies: [
          { adults: query.adults, childrenAges: query.childrenAges },
        ],
      });
      const withOffers = new Set(
        rates
          .filter(hotel => hotel.offers.length > 0)
          .map(hotel => hotel.hotelId),
      );
      return candidates.filter(row => withOffers.has(row.provider_hotel_id));
    } catch {
      return candidates;
    }
  }
}
