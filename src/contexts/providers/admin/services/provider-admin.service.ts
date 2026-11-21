import type {
  ProviderHotel,
  ProviderHotelSummary,
} from "../../domain/provider.types";
import type {
  DuplicateCandidate,
  DuplicateMatch,
  GeoPoint,
} from "../domain/duplicate-detection";
import type {
  ImagesImportedDto,
  ImportProviderHotelDto,
  LinkProviderHotelDto,
  SearchProviderHotelsQueryDto,
  UnlinkProviderSiteDto,
  UpdateProviderPetsDto,
  UpdateProviderStatusDto,
} from "../dto/provider-admin.dto";

import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Not, Repository } from "typeorm";

import { LegacyDbService } from "../../../shared/legacy-db/legacy-db.service";
import {
  LEGACY_CUSTOMER,
  LEGACY_TABLE,
  legacyTableSql,
} from "../../../shared/legacy-db/legacy-tables";
import {
  escapeHtmlText,
  htmlToPlainText,
  sanitizeRichText,
} from "../../../site-wizard/utils/site-content.utils";
import {
  ProviderError,
  ProviderNotFoundError,
} from "../../domain/provider.errors";
import { PROVIDER_NAME } from "../../domain/provider.types";
import {
  PROVIDER_PROPERTY_STATUS,
  ProviderPropertyEntity,
  type ProviderPropertyStatus,
} from "../../entities/provider-property.entity";
import { AccommodationProviderRegistry } from "../../services/accommodation-provider.registry";
import {
  boundingBox,
  DUPLICATE_LIMITS,
  findDuplicates,
  haversineMeters,
  parseLegacyCoordinate,
  toGeoPoint,
} from "../domain/duplicate-detection";
import {
  buildContentSnapshot,
  canActivate,
  formatCoordinate,
  IMPORT_ELIGIBILITY,
  importEligibility,
  initialPetsSnapshot,
  LEGACY_PROFILE_MODE,
  type PetsSnapshot,
  PROPERTY_ORIGIN,
  PROVIDER_ADMIN_ERROR,
  readContentExtras,
  readPetsSnapshot,
  slugify,
  toPreviousProfileMode,
  uniqueSlug,
} from "../domain/provider-import";

const PROVIDER = PROVIDER_NAME.NUITEE;
const SEARCH_DEFAULT_LIMIT = 25;
const SEARCH_DEFAULT_RADIUS_M = 5000;
const MAX_DUPLICATE_CANDIDATES = 5000;
const SHORT_DESCRIPTION_MAX = 300;
const SUGGESTED_POBLACIONES = 5;
const POBLACION_SEARCH_RADIUS_DEG = 0.5;
const CONTENT_ROW_LOCK = "FOR UPDATE";

export interface AdminActorRef {
  name: string | null;
}

interface SiteCoordRow {
  id: number;
  name: string | null;
  geolat: string | null;
  geolng: string | null;
  active: string | null;
  profile_mode: string | null;
}

interface SiteRow {
  id: number;
  name: string | null;
  alias_l1: string | null;
  active: string | null;
  profile_mode: string | null;
  premium: number | null;
}

interface PoblacionRow {
  id: number;
  poblacion: string | null;
  alias_poblacion: string | null;
  id_provincia: number;
  provincia: string | null;
  poblalat?: string | number | null;
  poblalng?: string | number | null;
}

interface CountRow {
  total: number | string;
}

export interface SearchHotelView {
  id: string;
  name: string;
  address: ProviderHotelSummary["address"];
  latitude: number | null;
  longitude: number | null;
  star_rating: number | null;
  pets_allowed: boolean | null;
  main_photo_url: string | null;
  linked_site_id: number | null;
  duplicates: DuplicateMatch[];
}

export interface SuggestedPoblacion {
  id: number;
  poblacion: string;
  id_provincia: number;
  provincia: string;
  distance_km: number;
}

export interface ProviderSiteView {
  site_id: number;
  site_name: string | null;
  site_alias: string | null;
  site_active: boolean;
  profile_mode: string | null;
  provider: string;
  provider_hotel_id: string;
  status: ProviderPropertyStatus;
  origin: string;
  previous_profile_mode: string;
  pets: PetsSnapshot | null;
  can_activate: boolean;
  images_total: number;
  images_imported_at: string | null;
  images_imported_count: number;
  last_synced_at: string | null;
  updated_at: string | null;
}

export interface ProviderSiteDetailView extends ProviderSiteView {
  /** Remote provider photos (admino downloads them, web owns the files). */
  images: { url: string; url_hd: string | null; caption: string | null }[];
  hotel_name: string | null;
}

/**
 * Admin side of external providers (plan phase 2): search provider hotels,
 * detect duplicates, import (case A) or link (case B) a v4p_jsites1 profile,
 * review pets and publish. Only admino calls it (X-Internal-Key via
 * web/admino/php/admOps_api.php).
 */
@Injectable()
export class ProviderAdminService {
  private readonly logger = new Logger(ProviderAdminService.name);

  constructor(
    @InjectRepository(ProviderPropertyEntity)
    private readonly propertyRepository: Repository<ProviderPropertyEntity>,
    private readonly registry: AccommodationProviderRegistry,
    private readonly legacyDb: LegacyDbService,
  ) {}

  // ---------------------------------------------------------------- search

  async searchHotels(query: SearchProviderHotelsQueryDto): Promise<{
    hotels: SearchHotelView[];
    total: number | null;
    limit: number;
    offset: number;
  }> {
    const hasCoords = query.lat !== undefined && query.lng !== undefined;
    const city = (query.city ?? "").trim();
    const country = (query.country ?? "").trim().toUpperCase();
    if (!hasCoords && (city === "" || country === "")) {
      throw new BadRequestException({
        code: PROVIDER_ADMIN_ERROR.INVALID_SEARCH,
        message: "Indica ciudad y país, o latitud y longitud.",
      });
    }
    const limit = query.limit ?? SEARCH_DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const result = await this.callProvider(() =>
      this.registry.get(PROVIDER).searchHotels({
        countryCode: country === "" ? undefined : country,
        cityName: hasCoords || city === "" ? undefined : city,
        latitude: hasCoords ? query.lat : undefined,
        longitude: hasCoords ? query.lng : undefined,
        radius: hasCoords
          ? (query.radius ?? SEARCH_DEFAULT_RADIUS_M)
          : undefined,
        limit,
        offset,
      }),
    );

    const linked = await this.linkedSitesByHotel(
      result.hotels.map(hotel => hotel.id),
    );
    const excluded = await this.linkedSiteIds();
    const candidates = await this.duplicateCandidates(result.hotels);
    const hotels = result.hotels.map(hotel => ({
      id: hotel.id,
      name: hotel.name,
      address: hotel.address,
      latitude: hotel.latitude,
      longitude: hotel.longitude,
      star_rating: hotel.starRating,
      pets_allowed: hotel.petsAllowed,
      main_photo_url: hotel.mainPhotoUrl,
      linked_site_id: linked.get(hotel.id) ?? null,
      duplicates: linked.has(hotel.id)
        ? []
        : findDuplicates(hotel, candidates, excluded),
    }));
    return { hotels, total: result.total, limit, offset };
  }

  async getHotel(hotelId: string): Promise<{
    hotel: ProviderHotel;
    linked_site_id: number | null;
    duplicates: DuplicateMatch[];
    eligibility: string;
    suggested_poblaciones: SuggestedPoblacion[];
  }> {
    const hotel = await this.fetchHotel(hotelId);
    const linked = await this.linkedSitesByHotel([hotel.id]);
    const linkedSiteId = linked.get(hotel.id) ?? null;
    const duplicates =
      linkedSiteId === null
        ? findDuplicates(
            hotel,
            await this.duplicateCandidates([hotel]),
            await this.linkedSiteIds(),
          )
        : [];
    return {
      hotel,
      linked_site_id: linkedSiteId,
      duplicates,
      eligibility: importEligibility(hotel),
      suggested_poblaciones: await this.suggestPoblaciones(hotel),
    };
  }

  // ---------------------------------------------------------------- import (A)

  async importHotel(
    dto: ImportProviderHotelDto,
    actor: AdminActorRef | null,
  ): Promise<{
    imported: boolean;
    site_id: number | null;
    alias: string | null;
    status: ProviderPropertyStatus | null;
    duplicates: DuplicateMatch[];
    needs_pets_review: boolean;
    images_pending: number;
  }> {
    await this.assertHotelFree(dto.hotel_id);
    const hotel = await this.fetchHotel(dto.hotel_id);
    const eligibility = this.assertEligible(hotel, dto.force_pets_review);

    const duplicates = findDuplicates(
      hotel,
      await this.duplicateCandidates([hotel]),
      await this.linkedSiteIds(),
    );
    if (duplicates.length > 0 && dto.ignore_duplicates !== true) {
      // Not an error: the admin chooses link (case B) or import anyway.
      return {
        imported: false,
        site_id: null,
        alias: null,
        status: null,
        duplicates,
        needs_pets_review: eligibility !== IMPORT_ELIGIBILITY.OK,
        images_pending: 0,
      };
    }

    const poblacion = await this.findPoblacion(dto.id_poblacion);
    if (
      dto.id_provincia !== undefined &&
      dto.id_provincia !== Number(poblacion.id_provincia)
    ) {
      throw new BadRequestException({
        code: PROVIDER_ADMIN_ERROR.PROVINCIA_MISMATCH,
        message: "La población no pertenece a esa provincia.",
      });
    }

    const now = new Date();
    const result = await this.legacyDb.transaction(async manager => {
      // Re-check inside the transaction (two admins importing at once).
      await this.assertHotelFree(dto.hotel_id, manager);
      const alias = await this.freeAlias(
        slugify((dto.alias ?? "").trim() || hotel.name),
        manager,
      );
      const siteId = await this.insertSite(manager, {
        hotel,
        alias,
        poblacion,
        tipsite: dto.tipsite ?? "",
      });
      await this.insertContent(manager, siteId, hotel);
      await this.removeDelisted(manager, hotel.id, siteId);
      await manager.getRepository(ProviderPropertyEntity).insert({
        provider: PROVIDER,
        provider_hotel_id: hotel.id,
        site_id: siteId,
        status: PROVIDER_PROPERTY_STATUS.DRAFT,
        pets_snapshot: initialPetsSnapshot(hotel),
        content_snapshot: buildContentSnapshot(hotel, {
          origin: PROPERTY_ORIGIN.IMPORT,
          previous_profile_mode: LEGACY_PROFILE_MODE.LEGACY,
          linked_at: now.toISOString(),
          linked_by: actor?.name ?? null,
        }),
        last_synced_at: now,
      });
      return { siteId, alias };
    });

    this.logger.log(
      `Imported ${PROVIDER} hotel ${hotel.id} as site ${result.siteId} (${actor?.name ?? "admino"})`,
    );
    return {
      imported: true,
      site_id: result.siteId,
      alias: result.alias,
      status: PROVIDER_PROPERTY_STATUS.DRAFT,
      duplicates,
      needs_pets_review: true,
      images_pending: hotel.images.length,
    };
  }

  // ---------------------------------------------------------------- link (B)

  async linkHotel(
    dto: LinkProviderHotelDto,
    actor: AdminActorRef | null,
  ): Promise<{
    linked: boolean;
    requires_confirmation: boolean;
    future_internal_reservations: number;
    site_id: number;
    status: ProviderPropertyStatus | null;
    previous_profile_mode: string | null;
  }> {
    const site = await this.findSite(dto.site_id);
    await this.assertSiteFree(site.id);
    await this.assertHotelFree(dto.hotel_id);
    const hotel = await this.fetchHotel(dto.hotel_id);
    this.assertEligible(hotel, dto.force_pets_review);

    const futureInternal = await this.countFutureReservations(
      site.id,
      "internal",
    );
    if (futureInternal > 0 && dto.confirm !== true) {
      return {
        linked: false,
        requires_confirmation: true,
        future_internal_reservations: futureInternal,
        site_id: site.id,
        status: null,
        previous_profile_mode: site.profile_mode,
      };
    }

    const now = new Date();
    const previous = await this.legacyDb.transaction(async manager => {
      const locked = await this.lockSite(manager, site.id);
      await this.assertSiteFree(site.id, manager);
      await this.assertHotelFree(hotel.id, manager);
      const previousMode = toPreviousProfileMode(locked.profile_mode);
      await this.legacyDb.query(
        `UPDATE ${legacyTableSql(LEGACY_TABLE.SITES1)}
         SET profile_mode = ? WHERE id = ? AND customer = ?`,
        [LEGACY_PROFILE_MODE.PROVIDER, site.id, LEGACY_CUSTOMER],
        manager,
      );
      await this.removeDelisted(manager, hotel.id, site.id);
      await manager.getRepository(ProviderPropertyEntity).insert({
        provider: PROVIDER,
        provider_hotel_id: hotel.id,
        site_id: site.id,
        status: PROVIDER_PROPERTY_STATUS.DRAFT,
        pets_snapshot: initialPetsSnapshot(hotel),
        content_snapshot: buildContentSnapshot(hotel, {
          origin: PROPERTY_ORIGIN.LINK,
          previous_profile_mode: previousMode,
          linked_at: now.toISOString(),
          linked_by: actor?.name ?? null,
        }),
        last_synced_at: now,
      });
      return previousMode;
    });

    this.logger.log(
      `Linked ${PROVIDER} hotel ${hotel.id} to site ${site.id} (was ${previous}; ${futureInternal} future internal reservations)`,
    );
    return {
      linked: true,
      requires_confirmation: false,
      future_internal_reservations: futureInternal,
      site_id: site.id,
      status: PROVIDER_PROPERTY_STATUS.DRAFT,
      previous_profile_mode: previous,
    };
  }

  // ---------------------------------------------------------------- sites

  async listSites(status?: string): Promise<ProviderSiteView[]> {
    const properties = await this.propertyRepository.find({
      where: {
        provider: PROVIDER,
        ...(status ? { status: status as ProviderPropertyStatus } : {}),
      },
      order: { updated_at: "DESC" },
      take: 500,
    });
    const sites = await this.sitesById(properties.map(row => row.site_id));
    return properties.map(row =>
      this.toSiteView(row, sites.get(row.site_id) ?? null),
    );
  }

  async getSite(siteId: number): Promise<ProviderSiteDetailView> {
    const property = await this.findProperty(siteId);
    const sites = await this.sitesById([siteId]);
    const view = this.toSiteView(property, sites.get(siteId) ?? null);
    const content = property.content_snapshot as Partial<ProviderHotel> | null;
    const images = Array.isArray(content?.images) ? content.images : [];
    return {
      ...view,
      hotel_name: typeof content?.name === "string" ? content.name : null,
      images: images
        .filter(image => typeof image.url === "string" && image.url !== "")
        .map(image => ({
          url: image.url,
          url_hd: image.urlHd ?? null,
          caption: image.caption ?? null,
        })),
    };
  }

  async updateStatus(
    siteId: number,
    dto: UpdateProviderStatusDto,
    actor: AdminActorRef | null,
  ): Promise<ProviderSiteView> {
    await this.legacyDb.transaction(async manager => {
      const property = await this.findProperty(siteId, manager);
      const site = await this.lockSite(manager, siteId);
      if (site.profile_mode !== LEGACY_PROFILE_MODE.PROVIDER) {
        throw new ConflictException({
          code: PROVIDER_ADMIN_ERROR.NOT_IN_PROVIDER_MODE,
          message: "El alojamiento ya no está vinculado al proveedor.",
        });
      }
      if (
        dto.status === PROVIDER_PROPERTY_STATUS.ACTIVE &&
        !canActivate(readPetsSnapshot(property.pets_snapshot))
      ) {
        throw new UnprocessableEntityException({
          code: PROVIDER_ADMIN_ERROR.PETS_REVIEW_REQUIRED,
          message:
            "Revisa y guarda la política de perros (admitidos) antes de publicar.",
        });
      }
      const origin = readContentExtras(property.content_snapshot).origin;
      // Case A owns its profile: publishing shows it, delisting hides it.
      // Case B profiles keep their own visibility (they existed before).
      if (origin === PROPERTY_ORIGIN.IMPORT) {
        if (dto.status === PROVIDER_PROPERTY_STATUS.ACTIVE) {
          await this.setSiteActive(manager, siteId, true);
        } else if (dto.status === PROVIDER_PROPERTY_STATUS.DELISTED) {
          await this.setSiteActive(manager, siteId, false);
        }
      }
      await manager
        .getRepository(ProviderPropertyEntity)
        .update(property.id, { status: dto.status });
    });
    this.logger.log(
      `Provider site ${siteId} -> ${dto.status} (${actor?.name ?? "admino"})`,
    );
    return this.getSite(siteId);
  }

  async updatePets(
    siteId: number,
    dto: UpdateProviderPetsDto,
    actor: AdminActorRef | null,
  ): Promise<ProviderSiteView> {
    const text = htmlToPlainText(dto.text);
    if (dto.reviewed && dto.allowed && text.length < 10) {
      throw new BadRequestException({
        code: PROVIDER_ADMIN_ERROR.PETS_POLICY_UNREADABLE,
        message: "Escribe la política de perros que verá el viajero.",
      });
    }
    await this.legacyDb.transaction(async manager => {
      const property = await this.findProperty(siteId, manager);
      const previous =
        readPetsSnapshot(property.pets_snapshot) ??
        initialPetsSnapshot({
          petsAllowed: null,
          petPolicy: {
            allowed: null,
            fee: null,
            feeAmountCents: null,
            feeCurrency: null,
            feeBasis: null,
            weightLimit: null,
            terms: null,
            text: null,
          },
        });
      const next: PetsSnapshot = {
        ...previous,
        petsAllowed: dto.allowed,
        petPolicy: {
          allowed: dto.allowed,
          fee: dto.fee ?? null,
          feeAmountCents: dto.fee_amount_cents ?? null,
          feeCurrency: dto.fee_currency ? dto.fee_currency.toUpperCase() : null,
          feeBasis: emptyToNull(dto.fee_basis),
          weightLimit: emptyToNull(dto.weight_limit),
          terms: emptyToNull(dto.terms ? htmlToPlainText(dto.terms) : null),
          text: text === "" ? null : text,
        },
        reviewed: dto.reviewed,
        reviewed_at: dto.reviewed ? new Date().toISOString() : null,
        reviewed_by: dto.reviewed ? (actor?.name ?? "admino") : null,
      };
      const changes: Partial<ProviderPropertyEntity> = { pets_snapshot: next };
      // Never keep selling a hotel whose pets policy no longer allows dogs.
      if (
        property.status === PROVIDER_PROPERTY_STATUS.ACTIVE &&
        !canActivate(next)
      ) {
        changes.status = PROVIDER_PROPERTY_STATUS.PAUSED;
      }
      await manager
        .getRepository(ProviderPropertyEntity)
        .update(property.id, changes);
    });
    return this.getSite(siteId);
  }

  async unlink(
    siteId: number,
    dto: UnlinkProviderSiteDto,
    actor: AdminActorRef | null,
  ): Promise<{
    unlinked: boolean;
    requires_confirmation: boolean;
    future_provider_reservations: number;
    restored_profile_mode: string | null;
  }> {
    const property = await this.findProperty(siteId);
    const futureProvider = await this.countFutureReservations(
      siteId,
      property.provider,
    );
    if (futureProvider > 0 && dto.confirm !== true) {
      return {
        unlinked: false,
        requires_confirmation: true,
        future_provider_reservations: futureProvider,
        restored_profile_mode: null,
      };
    }
    const extras = readContentExtras(property.content_snapshot);
    const restored = extras.previous_profile_mode;
    await this.legacyDb.transaction(async manager => {
      const site = await this.lockSite(manager, siteId);
      if (site.profile_mode === LEGACY_PROFILE_MODE.PROVIDER) {
        await this.legacyDb.query(
          `UPDATE ${legacyTableSql(LEGACY_TABLE.SITES1)}
           SET profile_mode = ? WHERE id = ? AND customer = ?`,
          [restored, siteId, LEGACY_CUSTOMER],
          manager,
        );
      }
      // An imported profile has no host behind it: hide it.
      if (extras.origin === PROPERTY_ORIGIN.IMPORT) {
        await this.setSiteActive(manager, siteId, false);
      }
      await manager
        .getRepository(ProviderPropertyEntity)
        .update(property.id, { status: PROVIDER_PROPERTY_STATUS.DELISTED });
    });
    this.logger.log(
      `Unlinked provider site ${siteId} -> ${restored} (${actor?.name ?? "admino"}; ${futureProvider} future provider reservations)`,
    );
    return {
      unlinked: true,
      requires_confirmation: false,
      future_provider_reservations: futureProvider,
      restored_profile_mode: restored,
    };
  }

  async markImagesImported(
    siteId: number,
    dto: ImagesImportedDto,
  ): Promise<ProviderSiteView> {
    const property = await this.findProperty(siteId);
    const content =
      typeof property.content_snapshot === "object" &&
      property.content_snapshot !== null
        ? (property.content_snapshot as Record<string, unknown>)
        : {};
    await this.propertyRepository.update(property.id, {
      content_snapshot: {
        ...content,
        images_imported_at: new Date().toISOString(),
        images_imported_count: dto.count,
      },
    });
    return this.getSite(siteId);
  }

  // ---------------------------------------------------------------- helpers

  private async callProvider<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (error instanceof ProviderNotFoundError) {
        throw new NotFoundException({
          code: PROVIDER_ADMIN_ERROR.PROVIDER_HOTEL_NOT_FOUND,
          message: "El proveedor no tiene ese hotel.",
        });
      }
      if (error instanceof ProviderError) {
        this.logger.warn(
          `Provider admin call failed: ${error.name} ${error.code} ${error.message}`,
        );
        throw new ServiceUnavailableException({
          code: PROVIDER_ADMIN_ERROR.PROVIDER_UNAVAILABLE,
          message: "El proveedor no responde. Inténtalo más tarde.",
        });
      }
      throw error;
    }
  }

  private fetchHotel(hotelId: string): Promise<ProviderHotel> {
    return this.callProvider(() =>
      this.registry.get(PROVIDER).getHotel(hotelId),
    );
  }

  private assertEligible(
    hotel: ProviderHotel,
    forcePetsReview: boolean | undefined,
  ): string {
    const eligibility = importEligibility(hotel);
    if (eligibility === IMPORT_ELIGIBILITY.PETS_NOT_ALLOWED) {
      throw new UnprocessableEntityException({
        code: PROVIDER_ADMIN_ERROR.PETS_NOT_ALLOWED,
        message: "El proveedor indica que el hotel no admite mascotas.",
      });
    }
    if (
      eligibility === IMPORT_ELIGIBILITY.NEEDS_PETS_REVIEW &&
      forcePetsReview !== true
    ) {
      throw new UnprocessableEntityException({
        code: PROVIDER_ADMIN_ERROR.PETS_POLICY_UNREADABLE,
        message:
          "El hotel no tiene una política de mascotas legible. Marca la revisión manual para importarlo.",
      });
    }
    return eligibility;
  }

  /** Active links (delisted rows do not count). */
  private async linkedSitesByHotel(
    hotelIds: readonly string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (hotelIds.length === 0) {
      return map;
    }
    const rows = await this.propertyRepository
      .createQueryBuilder("p")
      .select(["p.provider_hotel_id", "p.site_id"])
      .where("p.provider = :provider", { provider: PROVIDER })
      .andWhere("p.provider_hotel_id IN (:...ids)", { ids: [...hotelIds] })
      .andWhere("p.status <> :delisted", {
        delisted: PROVIDER_PROPERTY_STATUS.DELISTED,
      })
      .getMany();
    for (const row of rows) {
      map.set(row.provider_hotel_id, row.site_id);
    }
    return map;
  }

  private async linkedSiteIds(): Promise<Set<number>> {
    const rows = await this.propertyRepository.find({
      select: { site_id: true },
      where: { status: Not(PROVIDER_PROPERTY_STATUS.DELISTED) },
    });
    return new Set(rows.map(row => Number(row.site_id)));
  }

  /** jsites1 rows with coordinates around the given hotels (any status). */
  private async duplicateCandidates(
    hotels: readonly { latitude: number | null; longitude: number | null }[],
  ): Promise<DuplicateCandidate[]> {
    const points = hotels
      .map(hotel => toGeoPoint(hotel.latitude, hotel.longitude))
      .filter((point): point is GeoPoint => point !== null);
    const box = boundingBox(points, DUPLICATE_LIMITS.MAX_DISTANCE_M);
    if (!box) {
      return [];
    }
    // geolat/geolng are TEXT: only plain decimals are cast (others skipped).
    const rows = await this.legacyDb.query<SiteCoordRow>(
      `SELECT id, name, geolat, geolng, active, profile_mode
       FROM ${legacyTableSql(LEGACY_TABLE.SITES1)}
       WHERE customer = ?
         AND geolat REGEXP '^-?[0-9]{1,3}([.][0-9]+)?$'
         AND geolng REGEXP '^-?[0-9]{1,3}([.][0-9]+)?$'
         AND CAST(geolat AS DECIMAL(12,8)) BETWEEN ? AND ?
         AND CAST(geolng AS DECIMAL(12,8)) BETWEEN ? AND ?
       LIMIT ${MAX_DUPLICATE_CANDIDATES}`,
      [LEGACY_CUSTOMER, box.minLat, box.maxLat, box.minLng, box.maxLng],
    );
    const candidates: DuplicateCandidate[] = [];
    for (const row of rows) {
      const latitude = parseLegacyCoordinate(row.geolat);
      const longitude = parseLegacyCoordinate(row.geolng);
      if (latitude === null || longitude === null) {
        continue;
      }
      candidates.push({
        siteId: Number(row.id),
        name: String(row.name ?? ""),
        latitude,
        longitude,
        active: isActiveFlag(row.active),
        profileMode: String(row.profile_mode ?? LEGACY_PROFILE_MODE.LEGACY),
      });
    }
    return candidates;
  }

  /** Nearest poblaciones to the hotel (helps the admin pick id_poblacion). */
  private async suggestPoblaciones(
    hotel: ProviderHotel,
  ): Promise<SuggestedPoblacion[]> {
    const origin = toGeoPoint(hotel.latitude, hotel.longitude);
    if (!origin) {
      return [];
    }
    const lat = origin.latitude;
    const lng = origin.longitude;
    const rows = await this.legacyDb.query<PoblacionRow>(
      `SELECT p.id, p.poblacion, p.id_provincia, p.poblalat, p.poblalng,
              pr.provincia
       FROM ${legacyTableSql(LEGACY_TABLE.POBLACIONES)} p
       LEFT JOIN ${legacyTableSql(LEGACY_TABLE.PROVINCIAS)} pr ON pr.id = p.id_provincia
       WHERE p.poblalat BETWEEN ? AND ? AND p.poblalng BETWEEN ? AND ?
       LIMIT 500`,
      [
        lat - POBLACION_SEARCH_RADIUS_DEG,
        lat + POBLACION_SEARCH_RADIUS_DEG,
        lng - POBLACION_SEARCH_RADIUS_DEG,
        lng + POBLACION_SEARCH_RADIUS_DEG,
      ],
    );
    return rows
      .map(row => ({
        row,
        distance: haversineMeters(
          { latitude: lat, longitude: lng },
          {
            latitude: Number(row.poblalat),
            longitude: Number(row.poblalng),
          },
        ),
      }))
      .filter(item => Number.isFinite(item.distance))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, SUGGESTED_POBLACIONES)
      .map(({ row, distance }) => ({
        id: Number(row.id),
        poblacion: String(row.poblacion ?? ""),
        id_provincia: Number(row.id_provincia),
        provincia: String(row.provincia ?? ""),
        distance_km: Math.round(distance / 100) / 10,
      }));
  }

  private async findPoblacion(id: number): Promise<PoblacionRow> {
    const row = await this.legacyDb.queryOne<PoblacionRow>(
      `SELECT p.id, p.poblacion, p.alias_poblacion, p.id_provincia, pr.provincia
       FROM ${legacyTableSql(LEGACY_TABLE.POBLACIONES)} p
       LEFT JOIN ${legacyTableSql(LEGACY_TABLE.PROVINCIAS)} pr ON pr.id = p.id_provincia
       WHERE p.id = ?`,
      [id],
    );
    if (!row) {
      throw new BadRequestException({
        code: PROVIDER_ADMIN_ERROR.POBLACION_NOT_FOUND,
        message: "La población no existe.",
      });
    }
    return row;
  }

  private async findSite(siteId: number): Promise<SiteRow> {
    const row = await this.legacyDb.queryOne<SiteRow>(
      `SELECT id, name, alias_l1, active, profile_mode, premium
       FROM ${legacyTableSql(LEGACY_TABLE.SITES1)}
       WHERE id = ? AND customer = ?`,
      [siteId, LEGACY_CUSTOMER],
    );
    if (!row) {
      throw new NotFoundException({
        code: PROVIDER_ADMIN_ERROR.SITE_NOT_FOUND,
        message: "El alojamiento no existe.",
      });
    }
    return row;
  }

  private async lockSite(
    manager: EntityManager,
    siteId: number,
  ): Promise<SiteRow> {
    const row = await this.legacyDb.queryOne<SiteRow>(
      `SELECT id, name, alias_l1, active, profile_mode, premium
       FROM ${legacyTableSql(LEGACY_TABLE.SITES1)}
       WHERE id = ? AND customer = ? ${CONTENT_ROW_LOCK}`,
      [siteId, LEGACY_CUSTOMER],
      manager,
    );
    if (!row) {
      throw new NotFoundException({
        code: PROVIDER_ADMIN_ERROR.SITE_NOT_FOUND,
        message: "El alojamiento no existe.",
      });
    }
    return row;
  }

  private async sitesById(
    ids: readonly number[],
  ): Promise<Map<number, SiteRow>> {
    const map = new Map<number, SiteRow>();
    if (ids.length === 0) {
      return map;
    }
    const rows = await this.legacyDb.query<SiteRow>(
      `SELECT id, name, alias_l1, active, profile_mode, premium
       FROM ${legacyTableSql(LEGACY_TABLE.SITES1)}
       WHERE customer = ? AND id IN (?)`,
      [LEGACY_CUSTOMER, [...ids]],
    );
    for (const row of rows) {
      map.set(Number(row.id), row);
    }
    return map;
  }

  private async findProperty(
    siteId: number,
    manager?: EntityManager,
  ): Promise<ProviderPropertyEntity> {
    const repository = manager
      ? manager.getRepository(ProviderPropertyEntity)
      : this.propertyRepository;
    const property = await repository.findOne({
      where: { site_id: siteId, provider: PROVIDER },
    });
    if (!property) {
      throw new NotFoundException({
        code: PROVIDER_ADMIN_ERROR.PROPERTY_NOT_FOUND,
        message: "Este alojamiento no está vinculado al proveedor.",
      });
    }
    return property;
  }

  private async assertHotelFree(
    hotelId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repository = manager
      ? manager.getRepository(ProviderPropertyEntity)
      : this.propertyRepository;
    const existing = await repository.findOne({
      where: {
        provider: PROVIDER,
        provider_hotel_id: hotelId,
        status: Not(PROVIDER_PROPERTY_STATUS.DELISTED),
      },
    });
    if (existing) {
      throw new ConflictException({
        code: PROVIDER_ADMIN_ERROR.HOTEL_ALREADY_LINKED,
        message: `Este hotel ya está vinculado al alojamiento #${existing.site_id}.`,
        site_id: existing.site_id,
      });
    }
  }

  private async assertSiteFree(
    siteId: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repository = manager
      ? manager.getRepository(ProviderPropertyEntity)
      : this.propertyRepository;
    const existing = await repository.findOne({
      where: {
        site_id: siteId,
        status: Not(PROVIDER_PROPERTY_STATUS.DELISTED),
      },
    });
    if (existing) {
      throw new ConflictException({
        code: PROVIDER_ADMIN_ERROR.SITE_ALREADY_LINKED,
        message: "Este alojamiento ya está vinculado a un hotel del proveedor.",
      });
    }
  }

  /** Delisted rows keep the unique keys busy: drop them before relinking. */
  private async removeDelisted(
    manager: EntityManager,
    hotelId: string,
    siteId: number,
  ): Promise<void> {
    const repository = manager.getRepository(ProviderPropertyEntity);
    await repository.delete({
      provider: PROVIDER,
      provider_hotel_id: hotelId,
      status: PROVIDER_PROPERTY_STATUS.DELISTED,
    });
    await repository.delete({
      site_id: siteId,
      status: PROVIDER_PROPERTY_STATUS.DELISTED,
    });
  }

  private async countFutureReservations(
    siteId: number,
    source: string,
  ): Promise<number> {
    const row = await this.legacyDb.queryOne<CountRow>(
      `SELECT COUNT(*) AS total FROM reservations
       WHERE site_id = ? AND source = ? AND checkin >= CURDATE()
         AND status IN ('pending', 'confirmed')`,
      [siteId, source],
    );
    return Number(row?.total ?? 0);
  }

  private async freeAlias(
    base: string,
    manager: EntityManager,
  ): Promise<string> {
    const rows = await this.legacyDb.query<{ alias_l1: string | null }>(
      `SELECT alias_l1 FROM ${legacyTableSql(LEGACY_TABLE.SITES1)}
       WHERE customer = ? AND (alias_l1 = ? OR alias_l1 LIKE ?)`,
      [LEGACY_CUSTOMER, base, `${base.slice(0, 70)}-%`],
      manager,
    );
    return uniqueSlug(
      base,
      new Set(rows.map(row => String(row.alias_l1 ?? ""))),
    );
  }

  /**
   * New jsites1 profile (case A). Same NOT NULL columns as the host signup
   * (web/php/usregister_sendMail.php); inactive until published, no host
   * account (user_id NULL, accepted 'N'), premium 1 so all photos show,
   * reserva 'N' so neither the contact form nor /reservar appear.
   */
  private async insertSite(
    manager: EntityManager,
    input: {
      hotel: ProviderHotel;
      alias: string;
      poblacion: PoblacionRow;
      tipsite: string;
    },
  ): Promise<number> {
    const { hotel, alias, poblacion } = input;
    const result = await this.legacyDb.query<unknown>(
      `INSERT INTO ${legacyTableSql(LEGACY_TABLE.SITES1)} (
         customer, idback, name, fechainscr, active, premium, alias_l1,
         id_poblacion, poblacio, alias_poblacio, provincia, id_provincia,
         email, email2, telefono, destacado, id_club4patas, precio,
         tipsite, tipdest, tiprent, tipspec, tipserv,
         contador, contador_form, contador_web, contador_res, contador_tel,
         reserva, web, geolat, geolng, accepted, whatsapp_phone, capacity,
         rooms, tipenv, user_id, indexable, profile_mode
       ) VALUES (
         ?, 1, ?, CURDATE(), 'N', 1, ?,
         ?, ?, ?, ?, ?,
         '', '', '', 'N', 0, '',
         ?, '', '', '', '',
         0, 0, 0, 0, 0,
         'N', '', ?, ?, 'N', '', '0',
         '0', '', NULL, 1, ?
       )`,
      [
        LEGACY_CUSTOMER,
        hotel.name.slice(0, 250),
        alias,
        Number(poblacion.id),
        String(poblacion.poblacion ?? ""),
        String(poblacion.alias_poblacion ?? ""),
        String(poblacion.provincia ?? ""),
        Number(poblacion.id_provincia),
        input.tipsite,
        formatCoordinate(hotel.latitude),
        formatCoordinate(hotel.longitude),
        LEGACY_PROFILE_MODE.PROVIDER,
      ],
      manager,
    );
    const insertId = Number(
      (result as unknown as { insertId?: number }).insertId ?? 0,
    );
    if (insertId > 0) {
      return insertId;
    }
    const row = await this.legacyDb.queryOne<{ id: number }>(
      "SELECT LAST_INSERT_ID() AS id",
      [],
      manager,
    );
    const id = Number(row?.id ?? 0);
    if (id <= 0) {
      throw new Error("jsites1 insert returned no id");
    }
    return id;
  }

  /** jsites2 descriptions (short = plain text, long = whitelisted HTML). */
  private async insertContent(
    manager: EntityManager,
    siteId: number,
    hotel: ProviderHotel,
  ): Promise<void> {
    const plain = htmlToPlainText(hotel.description);
    const short =
      plain.length > SHORT_DESCRIPTION_MAX
        ? `${plain.slice(0, SHORT_DESCRIPTION_MAX - 1).replace(/\s+\S*$/, "")}…`
        : plain;
    const long = sanitizeRichText(hotel.description);
    await this.legacyDb.query(
      `INSERT INTO ${legacyTableSql(LEGACY_TABLE.SITES2)}
         (customer, idback, description1_l1, description2_l1)
       VALUES (?, ?, ?, ?)`,
      [LEGACY_CUSTOMER, siteId, escapeHtmlText(short), long],
      manager,
    );
  }

  private async setSiteActive(
    manager: EntityManager,
    siteId: number,
    active: boolean,
  ): Promise<void> {
    await this.legacyDb.query(
      `UPDATE ${legacyTableSql(LEGACY_TABLE.SITES1)}
       SET active = ? WHERE id = ? AND customer = ?`,
      [active ? "S" : "N", siteId, LEGACY_CUSTOMER],
      manager,
    );
  }

  private toSiteView(
    property: ProviderPropertyEntity,
    site: SiteRow | null,
  ): ProviderSiteView {
    const pets = readPetsSnapshot(property.pets_snapshot);
    const extras = readContentExtras(property.content_snapshot);
    const content = property.content_snapshot as Partial<ProviderHotel> | null;
    return {
      site_id: Number(property.site_id),
      site_name: site?.name ?? null,
      site_alias: site?.alias_l1 ?? null,
      site_active: isActiveFlag(site?.active ?? null),
      profile_mode: site?.profile_mode ?? null,
      provider: property.provider,
      provider_hotel_id: property.provider_hotel_id,
      status: property.status,
      origin: extras.origin,
      previous_profile_mode: extras.previous_profile_mode,
      pets,
      can_activate: canActivate(pets),
      images_total: Array.isArray(content?.images) ? content.images.length : 0,
      images_imported_at: extras.images_imported_at,
      images_imported_count: extras.images_imported_count,
      last_synced_at: toIso(property.last_synced_at ?? null),
      updated_at: toIso(property.updated_at),
    };
  }
}

function isActiveFlag(value: string | null): boolean {
  return value === "S" || value === "s";
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
