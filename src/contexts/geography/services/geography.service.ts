import type { GeoSearchQueryDto } from "../dto/geo-search-query.dto";
import type {
  Paginated,
  ProvinceOption,
  ProvinceRecord,
  TownOption,
  TownRecord,
} from "../types/geography.types";

import { Injectable, NotFoundException } from "@nestjs/common";

import { LegacyDbService } from "@/shared/legacy-db/legacy-db.service";
import {
  LEGACY_CUSTOMER,
  LEGACY_TABLE,
  legacyTableSql,
} from "@/shared/legacy-db/legacy-tables";
import { containsPattern, prefixPattern } from "@/shared/utils/sql-like";

const ACTIVE = "S";

interface RawProvinceRow {
  id: number;
  provincia: string | null;
  label: string | null;
}

interface RawTownRow {
  id: number;
  id_provincia: number;
  label: string | null;
  name: string | null;
  alias: string | null;
  lat: string | number | null;
  lng: string | number | null;
}

function clean(value: string | null): string {
  return (value ?? "").trim();
}

function toCoordinate(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTown(row: RawTownRow): TownRecord {
  return {
    id: Number(row.id),
    id_provincia: Number(row.id_provincia),
    label: clean(row.label),
    name: clean(row.name),
    alias: clean(row.alias),
    lat: toCoordinate(row.lat),
    lng: toCoordinate(row.lng),
  };
}

function toTownOption(town: TownRecord): TownOption {
  return {
    id: town.id,
    label: town.label,
    name: town.name,
    alias: town.alias,
    lat: town.lat,
    lng: town.lng,
  };
}

// Fetch limit + 1 rows to know whether another page exists
function paginate<T>(rows: T[], limit: number): Paginated<T> {
  return { items: rows.slice(0, limit), has_more: rows.length > limit };
}

@Injectable()
export class GeographyService {
  constructor(private readonly legacyDb: LegacyDbService) {}

  async listProvinces(
    query: GeoSearchQueryDto,
  ): Promise<Paginated<ProvinceOption>> {
    const params: unknown[] = [LEGACY_CUSTOMER, ACTIVE];
    let search = "";
    let order = "xt_provincia, id";
    if (query.q) {
      search = "AND (xt_provincia LIKE ? OR provincia LIKE ?)";
      order = "(xt_provincia LIKE ?) DESC, xt_provincia, id";
      params.push(
        containsPattern(query.q),
        containsPattern(query.q),
        prefixPattern(query.q),
      );
    }
    params.push(query.limit + 1, query.offset);

    const rows = await this.legacyDb.query<RawProvinceRow>(
      `SELECT id, provincia, xt_provincia AS label
       FROM ${legacyTableSql(LEGACY_TABLE.PROVINCIAS)}
       WHERE customer = ? AND active = ? ${search}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`,
      params,
    );

    return paginate(
      rows.map(row => ({ id: Number(row.id), label: clean(row.label) })),
      query.limit,
    );
  }

  async listTowns(
    provinceId: number,
    query: GeoSearchQueryDto,
  ): Promise<Paginated<TownOption>> {
    const province = await this.findActiveProvince(provinceId);
    if (!province) {
      throw new NotFoundException(`province ${provinceId} not found`);
    }

    const params: unknown[] = [LEGACY_CUSTOMER, provinceId];
    let search = "";
    let order = "poblacion, id";
    if (query.q) {
      search = "AND poblacion LIKE ?";
      order = "(poblacion LIKE ?) DESC, poblacion, id";
      params.push(containsPattern(query.q), prefixPattern(query.q));
    }
    params.push(query.limit + 1, query.offset);

    const rows = await this.legacyDb.query<RawTownRow>(
      `SELECT id, id_provincia, xt_poblacion AS label, poblacion AS name,
              alias_poblacion AS alias, poblalat AS lat, poblalng AS lng
       FROM ${legacyTableSql(LEGACY_TABLE.POBLACIONES)}
       WHERE customer = ? AND id_provincia = ? ${search}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`,
      params,
    );

    return paginate(
      rows.map(row => toTownOption(toTown(row))),
      query.limit,
    );
  }

  async findActiveProvince(id: number): Promise<ProvinceRecord | undefined> {
    const row = await this.legacyDb.queryOne<RawProvinceRow>(
      `SELECT id, provincia, xt_provincia AS label
       FROM ${legacyTableSql(LEGACY_TABLE.PROVINCIAS)}
       WHERE id = ? AND customer = ? AND active = ?`,
      [id, LEGACY_CUSTOMER, ACTIVE],
    );
    if (!row) {
      return undefined;
    }
    return {
      id: Number(row.id),
      provincia: clean(row.provincia),
      label: clean(row.label),
    };
  }

  async findTown(id: number): Promise<TownRecord | undefined> {
    const row = await this.legacyDb.queryOne<RawTownRow>(
      `SELECT id, id_provincia, xt_poblacion AS label, poblacion AS name,
              alias_poblacion AS alias, poblalat AS lat, poblalng AS lng
       FROM ${legacyTableSql(LEGACY_TABLE.POBLACIONES)}
       WHERE id = ? AND customer = ?`,
      [id, LEGACY_CUSTOMER],
    );
    return row ? toTown(row) : undefined;
  }
}
