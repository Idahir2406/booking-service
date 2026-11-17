import type {
  WizardDogPolicyPayload,
  WizardReviewPayload,
  WizardServicesPayload,
} from "../types/site-wizard.types";
import type {
  ReviewsInput,
  ScoreUnitInput,
} from "../utils/dog-friendly-score.utils";

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { LegacyDbService } from "@/shared/legacy-db/legacy-db.service";
import {
  LEGACY_CUSTOMER,
  LEGACY_TABLE,
  legacyTableSql,
} from "@/shared/legacy-db/legacy-tables";

import { AdditionalServiceEntity } from "@/contexts/additional-services/entities/additional-service.entity";
import { CommonZoneEntity } from "@/contexts/common-zones/entities/common-zone.entity";
import { DogSizeEntity } from "@/contexts/dog-sizes/entities/dog-size.entity";
import { DogSupplyEntity } from "@/contexts/dog-supplies/entities/dog-supply.entity";
import { ReservationEntity } from "@/contexts/reservations/entities/reservation.entity";
import { ReservationGuestFeedbackEntity } from "@/contexts/reservations/entities/reservation-guest-feedback.entity";
import { StripeService } from "@/contexts/stripe/services/stripe.service";

import { SiteSettingsEntity } from "../entities/site-settings.entity";
import {
  computeDogFriendlyScore,
  roundOne,
} from "../utils/dog-friendly-score.utils";
import { isMaxPetsAnswered } from "../utils/dog-policy.utils";
import {
  buildCompleteness,
  isPropertyComplete,
  missingRequired,
  missingRequiredErrors,
  parsePublishInput,
  relaxedItemsFor,
  REVIEW_ITEM,
} from "../utils/site-review.utils";
import { isScheduleConfigured } from "../utils/site-schedule.utils";
import { SiteBookingSettingsWizardService } from "./site-booking-settings-wizard.service";
import { SiteContentWizardService } from "./site-content-wizard.service";
import { SiteDogPolicyWizardService } from "./site-dog-policy-wizard.service";
import { SiteServicesWizardService } from "./site-services-wizard.service";
import { SiteWizardService } from "./site-wizard.service";

/** Last wizard step ("Revisión"). */
const FINAL_STEP = 7;
const ACTIVE = "S";

interface SiteStatusRow {
  active: string | null;
}

interface ReviewsRow {
  total: number | string | null;
  average: number | string | null;
}

/**
 * Wizard step 7 ("Revisión"): completeness checklist, Dog Friendly Score
 * and submission for admin review. Publishing only records the submission
 * (terms + wizard_completed_at): v4p_jsites1.active stays under admin control.
 */
@Injectable()
export class SiteReviewWizardService {
  private readonly logger = new Logger(SiteReviewWizardService.name);

  constructor(
    private readonly legacyDb: LegacyDbService,
    private readonly siteWizardService: SiteWizardService,
    private readonly dogPolicyService: SiteDogPolicyWizardService,
    private readonly servicesService: SiteServicesWizardService,
    private readonly contentService: SiteContentWizardService,
    private readonly bookingSettingsService: SiteBookingSettingsWizardService,
    private readonly stripeService: StripeService,
    @InjectRepository(SiteSettingsEntity)
    private readonly siteSettingsRepository: Repository<SiteSettingsEntity>,
    @InjectRepository(DogSizeEntity)
    private readonly dogSizesRepository: Repository<DogSizeEntity>,
    @InjectRepository(CommonZoneEntity)
    private readonly commonZonesRepository: Repository<CommonZoneEntity>,
    @InjectRepository(DogSupplyEntity)
    private readonly suppliesRepository: Repository<DogSupplyEntity>,
    @InjectRepository(AdditionalServiceEntity)
    private readonly servicesRepository: Repository<AdditionalServiceEntity>,
    @InjectRepository(ReservationGuestFeedbackEntity)
    private readonly feedbackRepository: Repository<ReservationGuestFeedbackEntity>,
    @InjectRepository(ReservationEntity)
    private readonly reservationsRepository: Repository<ReservationEntity>,
  ) {}

  async get(
    siteId: number,
    userId: number | null,
  ): Promise<WizardReviewPayload> {
    const [state, dogPolicy, services, content, booking, settings, siteStatus] =
      await Promise.all([
        this.siteWizardService.getState(siteId),
        this.dogPolicyService.get(siteId),
        this.servicesService.get(siteId),
        this.contentService.get(siteId),
        this.bookingSettingsService.get(siteId),
        this.siteSettingsRepository.findOne({ where: { site_id: siteId } }),
        this.findSiteStatus(siteId),
      ]);
    const [stripeConnected, reviews, units, catalog] = await Promise.all([
      this.isStripeConnected(userId),
      this.findReviews(siteId),
      this.toScoreUnits(dogPolicy),
      this.loadScoreCatalog(),
    ]);

    const activePolicies = dogPolicy.units.filter(unit => unit.is_active);
    const completeness = buildCompleteness(
      {
        [REVIEW_ITEM.PROPERTY]: isPropertyComplete(state.property),
        [REVIEW_ITEM.UNITS]: state.units_count > 0,
        [REVIEW_ITEM.DOG_POLICY]:
          isMaxPetsAnswered({
            max_pets: dogPolicy.max_pets,
            max_pets_unlimited: dogPolicy.max_pets_unlimited,
          }) &&
          activePolicies.length > 0 &&
          activePolicies.every(unit => unit.missing.length === 0),
        [REVIEW_ITEM.SUPPLIES_REVIEWED]:
          services.dog_supplies.length > 0 &&
          services.dog_supplies.every(row => row.state !== "unanswered"),
        [REVIEW_ITEM.FEATURES]: Object.values(services.features).some(
          ids => ids.length > 0,
        ),
        [REVIEW_ITEM.COVER_PHOTO]: content.images.some(
          image => image.slot === 1,
        ),
        [REVIEW_ITEM.DESCRIPTION_SHORT]: content.description_short !== "",
        [REVIEW_ITEM.DESCRIPTION_LONG]: content.description_long !== "",
        [REVIEW_ITEM.AVAILABILITY]: booking.availability.configured,
        [REVIEW_ITEM.CANCELLATION_POLICY]: booking.cancellation !== null,
        [REVIEW_ITEM.SCHEDULE]: isScheduleConfigured(booking.schedule),
        [REVIEW_ITEM.STRIPE]: stripeConnected,
      },
      { optional: relaxedItemsFor(settings?.wizard_completed_at != null) },
    );
    const missing = missingRequired(completeness);

    const score = computeDogFriendlyScore({
      units,
      extraZoneIds: catalog.extraZoneIds,
      ...this.servicePoints(services, catalog),
      reviews,
    });

    return {
      completeness,
      score: {
        objective: score.objective,
        score: score.score,
        paws: score.paws,
        blocks: score.blocks,
        reviews: {
          count: reviews.count,
          average: reviews.average === null ? null : roundOne(reviews.average),
        },
      },
      can_publish: missing.length === 0,
      missing_required: missing,
      status: {
        submitted_at: settings?.wizard_completed_at?.toISOString() ?? null,
        terms_accepted_at: settings?.terms_accepted_at?.toISOString() ?? null,
        terms_version: settings?.terms_version ?? null,
        active: (siteStatus.active ?? "").trim() === ACTIVE,
      },
    };
  }

  async publish(siteId: number, body: unknown): Promise<WizardReviewPayload> {
    const parsed = parsePublishInput(body);
    if (!parsed.ok) {
      throw new BadRequestException(parsed.errors);
    }
    const input = parsed.value;

    const review = await this.get(siteId, input.user_id);
    if (!review.can_publish) {
      throw new BadRequestException(
        missingRequiredErrors(review.missing_required),
      );
    }

    const table = this.siteSettingsRepository.metadata.tableName;
    await this.siteSettingsRepository.manager.query(
      `INSERT INTO \`${table}\`
         (site_id, wizard_step, wizard_completed_at,
          terms_accepted_at, terms_version, terms_accepted_by)
       VALUES (?, ?, NOW(), NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE
         wizard_step = GREATEST(wizard_step, VALUES(wizard_step)),
         wizard_completed_at = VALUES(wizard_completed_at),
         terms_accepted_at = VALUES(terms_accepted_at),
         terms_version = VALUES(terms_version),
         terms_accepted_by = VALUES(terms_accepted_by)`,
      [siteId, FINAL_STEP, input.terms_version, input.user_id],
    );

    return this.get(siteId, input.user_id);
  }

  private servicePoints(
    services: WizardServicesPayload,
    catalog: ScoreCatalog,
  ): Pick<
    Parameters<typeof computeDogFriendlyScore>[0],
    "amenityPoints" | "facilityPoints" | "servicePoints"
  > {
    const amenityPoints: number[] = [];
    const facilityPoints: number[] = [];
    for (const row of services.dog_supplies) {
      const supply = catalog.supplies.get(row.supply_id);
      if (row.state !== "yes" || !supply?.is_scoring) {
        continue;
      }
      const points = Number(supply.score_points);
      if (supply.section === "amenity") {
        amenityPoints.push(points);
      } else {
        facilityPoints.push(points);
      }
    }
    const servicePoints = services.additional_services
      .filter(row => row.state === "yes")
      .map(row =>
        Number(catalog.services.get(row.service_id)?.score_points ?? 0),
      );
    return { amenityPoints, facilityPoints, servicePoints };
  }

  private async toScoreUnits(
    dogPolicy: WizardDogPolicyPayload,
  ): Promise<ScoreUnitInput[]> {
    const sizes = await this.dogSizesRepository.find();
    const rankById = new Map(sizes.map(size => [size.id, size.rank]));
    return dogPolicy.units
      .filter(unit => unit.is_active)
      .map(unit => ({
        ppp_allowed: unit.policy.ppp_allowed,
        max_size_rank:
          unit.policy.max_size_id === null
            ? null
            : (rankById.get(unit.policy.max_size_id) ?? null),
        is_full_use: unit.is_full_use,
        full_unit_access: unit.policy.full_unit_access,
        zone_ids: unit.policy.zones.map(zone => zone.zone_id),
        dining_zone_ids: unit.policy.dining_zone_ids,
      }));
  }

  private async loadScoreCatalog(): Promise<ScoreCatalog> {
    const [zones, supplies, services] = await Promise.all([
      this.commonZonesRepository.find(),
      this.suppliesRepository.find(),
      this.servicesRepository.find(),
    ]);
    return {
      extraZoneIds: new Set(
        zones.filter(zone => zone.counts_as_extra_zone).map(zone => zone.id),
      ),
      supplies: new Map(supplies.map(row => [row.id, row])),
      services: new Map(services.map(row => [row.id, row])),
    };
  }

  /**
   * Verified reviews = guest feedback of type "review" (1-5 rating) sent
   * through the post-stay token of a reservation of this site.
   */
  private async findReviews(siteId: number): Promise<ReviewsInput> {
    const feedbackTable = this.feedbackRepository.metadata.tableName;
    const reservationsTable = this.reservationsRepository.metadata.tableName;
    const rows = await this.feedbackRepository.manager.query<ReviewsRow[]>(
      `SELECT COUNT(*) AS total, AVG(f.rating) AS average
       FROM \`${feedbackTable}\` f
       INNER JOIN \`${reservationsTable}\` r ON r.id = f.reservation_id
       WHERE r.site_id = ? AND f.type = 'review' AND f.rating IS NOT NULL`,
      [siteId],
    );
    const row = rows.at(0);
    const count = Number(row?.total ?? 0);
    const rawAverage = row?.average ?? null;
    const average =
      count > 0 && rawAverage !== null ? Number(rawAverage) : null;
    return { count, average };
  }

  /** Optional check: unknown user / Stripe error -> not connected. */
  private async isStripeConnected(userId: number | null): Promise<boolean> {
    if (userId === null) {
      return false;
    }
    try {
      const status = await this.stripeService.getConnectStatus(userId);
      return status.can_use_reservations;
    } catch (error: unknown) {
      this.logger.warn(
        `stripe connect status failed for user ${userId}: ${String(error)}`,
      );
      return false;
    }
  }

  private async findSiteStatus(siteId: number): Promise<SiteStatusRow> {
    const row = await this.legacyDb.queryOne<SiteStatusRow>(
      `SELECT active FROM ${legacyTableSql(LEGACY_TABLE.SITES1)}
       WHERE id = ? AND customer = ?`,
      [siteId, LEGACY_CUSTOMER],
    );
    if (!row) {
      throw new NotFoundException(`site ${siteId} not found`);
    }
    return row;
  }
}

interface ScoreCatalog {
  extraZoneIds: ReadonlySet<number>;
  supplies: ReadonlyMap<number, DogSupplyEntity>;
  services: ReadonlyMap<number, AdditionalServiceEntity>;
}
