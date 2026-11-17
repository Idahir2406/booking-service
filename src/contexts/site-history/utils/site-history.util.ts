import { type FlatValue, SITE_AUDIT_ACTION } from "./site-change.util";

/**
 * Accommodation change history for the host panel and admino. Pure: turns
 * audit_log rows (entity "site") into labelled items with one line per field
 * ("Régimen BB · Precio: 80,00 € → 95,00 €").
 *
 * Audience:
 * - host: admin names hidden ("viajes4patas").
 * - admin: admin name + source.
 */

export type SiteHistoryAudience = "host" | "admin";
export type SiteHistoryActor = "system" | "host" | "admin";

export interface SiteHistoryAuditInput {
  id: string | number;
  action: string;
  actor_type: string;
  actor_id?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  created_at: Date;
}

export interface SiteHistoryChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

export interface SiteHistoryItem {
  id: string;
  at: string;
  action: string;
  label: string;
  actor: SiteHistoryActor;
  actor_label: string;
  source: string | null;
  subject: string | null;
  changes: SiteHistoryChange[];
}

/** Optional id -> name catalogs (dog supplies, additional services...). */
export interface SiteHistoryCatalogs {
  dog_supplies?: ReadonlyMap<string, string>;
  additional_services?: ReadonlyMap<string, string>;
}

const ACTION_LABELS: Readonly<Record<string, string>> = {
  [SITE_AUDIT_ACTION.PROPERTY_UPDATED]: "Datos generales modificados",
  [SITE_AUDIT_ACTION.UNIT_CREATED]: "Unidad creada",
  [SITE_AUDIT_ACTION.UNIT_UPDATED]: "Unidad modificada",
  [SITE_AUDIT_ACTION.UNIT_DELETED]: "Unidad eliminada o desactivada",
  [SITE_AUDIT_ACTION.DOG_MAX_PETS_UPDATED]: "Máximo de perros modificado",
  [SITE_AUDIT_ACTION.UNIT_DOG_POLICY_UPDATED]:
    "Política de perros de la unidad modificada",
  [SITE_AUDIT_ACTION.UNIT_DOG_POLICY_COPIED]: "Política de perros copiada",
  [SITE_AUDIT_ACTION.SERVICES_UPDATED]: "Servicios / cunas modificados",
  [SITE_AUDIT_ACTION.CONTENT_UPDATED]: "Descripción modificada",
  [SITE_AUDIT_ACTION.BOOKING_SETTINGS_UPDATED]:
    "Condiciones de reserva modificadas",
  [SITE_AUDIT_ACTION.PUBLISHED]:
    "Alojamiento enviado a revisión (términos aceptados)",
  [SITE_AUDIT_ACTION.PHOTOS_CHANGED]: "Fotos modificadas",
  [SITE_AUDIT_ACTION.AVAILABILITY_CHANGED]: "Disponibilidad modificada",
  [SITE_AUDIT_ACTION.BLOCK_CREATED]: "Bloqueo de fechas creado",
  [SITE_AUDIT_ACTION.BLOCK_UPDATED]: "Bloqueo de fechas modificado",
  [SITE_AUDIT_ACTION.BLOCK_DELETED]: "Bloqueo de fechas eliminado",
  [SITE_AUDIT_ACTION.STRIPE_ACCOUNT_LINKED]: "Cuenta de cobro vinculada",
  [SITE_AUDIT_ACTION.LEGACY_PROFILE_UPDATED]: "Perfil modificado",
  [SITE_AUDIT_ACTION.ADMIN_UPDATED]: "Modificado por viajes4patas",
  [SITE_AUDIT_ACTION.ADMIN_DELETED]: "Eliminado por viajes4patas",
};

/** Label of a path segment name (last wins when nested). */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  // item identity (shown when an item is added/removed)
  code: "Código",
  supply_id: "Id",
  service_id: "Id",
  zone_id: "Zona (id)",
  slot: "Posición",
  // property
  name: "Nombre",
  email: "Email",
  email2: "Email secundario",
  telefono: "Teléfono",
  whatsapp_prefix: "WhatsApp (prefijo)",
  whatsapp_number: "WhatsApp",
  main_tipsite_id: "Tipo principal",
  tipsite: "Tipo de alojamiento",
  tipo_de_alquiler: "Tipo de alquiler",
  tiprent: "Tipo de alquiler",
  id_provincia: "Provincia (id)",
  provincia_label: "Provincia",
  id_poblacion: "Población (id)",
  poblacion_label: "Población",
  poblacio: "Población",
  geolat: "Latitud",
  geolng: "Longitud",
  interes: "Punto de interés",
  distancia: "Distancia",
  ubicacion: "Ubicación",
  tipenv: "Entorno",
  tipdest: "Destino",
  tipspec: "Servicios para perros",
  tipserv: "Servicios",
  precio: "Precio",
  // units
  units: "Unidad",
  site_unit_name: "Tipo de unidad",
  is_full_use: "Uso completo",
  description: "Descripción",
  price_per_night: "Precio por noche",
  max_guests: "Huéspedes máx.",
  bathrooms: "Baños",
  is_active: "Activa",
  board_options: "Régimen",
  extras: "Extra",
  price: "Precio",
  is_included: "Incluido en el precio",
  is_default: "Por defecto",
  pricing_mode: "Modo de precio",
  soft_deleted: "Desactivada (tiene reservas futuras)",
  // dog policy
  max_pets: "Máximo de perros",
  max_pets_unlimited: "Perros sin límite",
  max_size_id: "Tamaño máximo (id)",
  ppp_allowed: "Admite PPP",
  supplement_mode: "Suplemento por perro",
  supplement_amount: "Importe del suplemento",
  left_alone: "Puede quedarse solo",
  left_alone_conditions: "Condiciones para quedarse solo",
  full_unit_access: "Acceso a toda la unidad",
  deposit_required: "Fianza",
  deposit_amount: "Importe de la fianza",
  deposit_return: "Devolución de la fianza",
  deposit_return_days: "Días para devolver la fianza",
  notes: "Notas",
  common_zones_answered: "Zonas comunes respondidas",
  zones: "Zona común",
  other_text: "Otra",
  dining_zones_answered: "Comedor respondido",
  dining_zone_ids: "Zonas de comedor",
  from_room_id: "Copiada de la unidad",
  // services
  dog_supplies: "Para el perro",
  additional_services: "Servicio",
  features: "Características",
  tipspec_extra: "Extras",
  state: "Disponible",
  is_paid: "De pago",
  cribs: "Cunas",
  offered: "Ofrece cunas",
  count: "Número",
  note: "Cómo solicitarlas",
  // content
  description_short: "Descripción corta",
  description_long: "Descripción larga",
  images: "Foto",
  file: "Archivo",
  // booking settings
  availability: "Disponibilidad",
  configured: "Configurada",
  mode: "Modo",
  min_nights: "Noches mínimas",
  max_nights: "Noches máximas",
  cancellation: "Cancelación",
  policy_type: "Política",
  deadline_days: "Plazo (días)",
  penalty_type: "Penalización",
  no_show_policy: "No presentación",
  grace_after_booking_hours: "Horas de gracia tras reservar",
  early_cancellation_weeks: "Semanas de cancelación anticipada",
  timezone: "Zona horaria",
  schedule: "Horario",
  checkin_from: "Entrada desde",
  checkin_until: "Entrada hasta",
  checkout_until: "Salida hasta",
  // publish
  terms_version: "Versión de los términos",
  terms_accepted_at: "Términos aceptados",
  // calendar
  room_id: "Unidad (id)",
  start_date: "Desde",
  end_date: "Hasta",
  from: "Desde",
  to: "Hasta",
  days: "Días",
  is_available: "Abierto",
  type: "Tipo",
  // stripe
  linked: "Vinculada",
};

/** Fields shown as money. */
const MONEY_FIELDS: ReadonlySet<string> = new Set([
  "price",
  "price_per_night",
  "supplement_amount",
  "deposit_amount",
  "precio",
]);

const VALUE_LABELS: Readonly<Record<string, string>> = {
  yes: "Sí",
  no: "No",
  unanswered: "Sin responder",
  per_stay: "por estancia",
  per_night: "por noche",
  per_pet: "por perro",
  per_pet_night: "por perro y noche",
  maintenance: "mantenimiento",
  manual_block: "bloqueo manual",
};

const ACTOR_LABELS: Readonly<Record<SiteHistoryActor, string>> = {
  system: "Sistema",
  host: "Alojamiento",
  admin: "viajes4patas",
};

interface Segment {
  name: string;
  key: string | null;
}

const SEGMENT = /^([^[\]]*)(?:\[([^\]]*)\])?$/;

function parseSegments(path: string): Segment[] {
  const segments: Segment[] = [];
  // "board_options[BB].price" | "[12].name" | "features.tipcom"
  for (const raw of path.split(/\.(?![^[]*\])/)) {
    const match = SEGMENT.exec(raw);
    if (match) {
      // Group 2 (the [key]) is optional: absent -> undefined at runtime.
      const [, name, key] = match as unknown as [
        string,
        string,
        string | undefined,
      ];
      segments.push({ name, key: key ?? null });
    } else {
      segments.push({ name: raw, key: null });
    }
  }
  return segments;
}

function lookup(
  map: ReadonlyMap<string, string> | undefined,
  key: string,
): string {
  return map?.get(key) ?? `#${key}`;
}

/** Legacy columns with a number/lang suffix (image7, description2_es). */
function patternLabel(name: string): string | null {
  const image = /^image(\d{1,2})$/.exec(name);
  if (image) {
    return `Foto ${image[1]}`;
  }
  const description = /^description([12])_([a-z]{2})$/.exec(name);
  if (description) {
    const kind = description[1] === "1" ? "corta" : "larga";
    return `Descripción ${kind} (${description[2]})`;
  }
  return null;
}

function segmentLabel(segment: Segment, catalogs: SiteHistoryCatalogs): string {
  const base = Object.hasOwn(FIELD_LABELS, segment.name)
    ? FIELD_LABELS[segment.name]
    : (patternLabel(segment.name) ?? segment.name.replaceAll("_", " "));
  if (segment.key === null) {
    return base;
  }
  if (segment.name === "dog_supplies") {
    return `${base}: ${lookup(catalogs.dog_supplies, segment.key)}`;
  }
  if (segment.name === "additional_services") {
    return `${base}: ${lookup(catalogs.additional_services, segment.key)}`;
  }
  return base === "" ? `#${segment.key}` : `${base} ${segment.key}`;
}

export function fieldLabel(
  path: string,
  catalogs: SiteHistoryCatalogs = {},
): string {
  return parseSegments(path)
    .map(segment => segmentLabel(segment, catalogs))
    .filter(label => label !== "")
    .join(" · ");
}

function lastName(path: string): string {
  const segments = parseSegments(path);
  return segments.at(-1)?.name ?? path;
}

export function formatValue(path: string, value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "Sí" : "No";
  }
  const field = lastName(path);
  if (MONEY_FIELDS.has(field)) {
    const amount = Number(value);
    if (Number.isFinite(amount)) {
      return `${amount.toFixed(2).replace(".", ",")} €`;
    }
  }
  const text = String(value as FlatValue);
  return Object.hasOwn(VALUE_LABELS, text) ? VALUE_LABELS[text] : text;
}

function isActor(value: string): value is SiteHistoryActor {
  return value === "system" || value === "host" || value === "admin";
}

function adminName(actorId: string | null | undefined): string | null {
  if (!actorId) {
    return null;
  }
  return actorId.startsWith("admino:") ? actorId.slice(7) : actorId;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function changesOf(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  catalogs: SiteHistoryCatalogs,
): SiteHistoryChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.sort().map(field => ({
    field,
    label: fieldLabel(field, catalogs),
    before: formatValue(field, before[field]),
    after: formatValue(field, after[field]),
  }));
}

export function buildSiteHistory(
  audits: readonly SiteHistoryAuditInput[],
  audience: SiteHistoryAudience,
  catalogs: SiteHistoryCatalogs = {},
): SiteHistoryItem[] {
  return audits.map(audit => {
    const actor: SiteHistoryActor = isActor(audit.actor_type)
      ? audit.actor_type
      : "system";
    const metadata = audit.metadata ?? {};
    const name =
      audience === "admin" && actor === "admin"
        ? adminName(audit.actor_id)
        : null;
    return {
      id: String(audit.id),
      at: audit.created_at.toISOString(),
      action: audit.action,
      label: Object.hasOwn(ACTION_LABELS, audit.action)
        ? ACTION_LABELS[audit.action]
        : audit.action,
      actor,
      actor_label: name
        ? `${ACTOR_LABELS.admin} (${name})`
        : ACTOR_LABELS[actor],
      source: audience === "admin" ? text(metadata.source) : null,
      subject: text(metadata.room_name) ?? text(metadata.subject),
      changes: changesOf(audit.before ?? {}, audit.after ?? {}, catalogs),
    };
  });
}
