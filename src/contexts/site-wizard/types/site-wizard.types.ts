import type {
  DepositReturnValue,
  LeftAloneValue,
  SupplementModeValue,
} from "@/contexts/pet-policies/entities/unit-pet-policy.entity";
import type { AnswerStateValue } from "@/contexts/shared/types/answer-state";
import type { ServicePricingModeValue } from "@/contexts/shared/types/service-pricing-mode";

export interface SiteWizardProperty {
  main_tipsite_id: number | null;
  tipsite: number[];
  tipo_de_alquiler: number | null;
  name: string;
  email: string;
  email2: string;
  telefono: string;
  whatsapp_prefix: string | null;
  whatsapp_number: string | null;
  id_provincia: number | null;
  provincia_label: string;
  id_poblacion: number | null;
  poblacion_label: string;
  geolat: number | null;
  geolng: number | null;
  interes: string;
  distancia: string;
  ubicacion: string;
  tipenv: number | null;
  tipdest: number[];
}

export interface SiteWizardState {
  site_id: number;
  wizard_step: number;
  /** Active units (rooms) of the site. */
  units_count: number;
  /** Last submission for admin review (wizard_completed_at), ISO or null. */
  submitted_at: string | null;
  property: SiteWizardProperty;
}

export interface WizardUnitBoardOption {
  code: string;
  price: number;
  is_included: boolean;
  is_default: boolean;
  is_active: boolean;
}

export interface WizardUnitExtra {
  id: number;
  name: string;
  description: string | null;
  pricing_mode: string;
  price: number;
  is_active: boolean;
}

export interface WizardUnit {
  id: number;
  site_unit_id: number | null;
  site_unit_name: string | null;
  is_full_use: boolean;
  name: string;
  description: string | null;
  price_per_night: number;
  max_guests: number;
  bathrooms: number;
  is_active: boolean;
  sort_order: number;
  board_options: WizardUnitBoardOption[];
  extras: WizardUnitExtra[];
}

export interface WizardUnitsSummary {
  count: number;
  capacity: number;
  bathrooms: number;
  min_price: number | null;
}

export interface WizardUnitsPayload {
  units: WizardUnit[];
  summary: WizardUnitsSummary;
}

/** Common zone the dog may access (step 3). other_text only for "Otras". */
export interface WizardDogPolicyZone {
  zone_id: number;
  other_text: string | null;
}

/**
 * Dog policy of one unit (step 3). Scalars: null = not answered yet.
 * zones / dining_zone_ids: [] when nothing is selected; "Ninguna" is
 * common_zones_answered / dining_zones_answered = true with an empty list.
 */
export interface WizardDogPolicy {
  max_size_id: number | null;
  ppp_allowed: boolean | null;
  supplement_mode: SupplementModeValue | null;
  supplement_amount: number | null;
  left_alone: LeftAloneValue | null;
  left_alone_conditions: string | null;
  full_unit_access: boolean | null;
  deposit_required: boolean | null;
  deposit_amount: number | null;
  deposit_return: DepositReturnValue | null;
  deposit_return_days: number | null;
  notes: string | null;
  common_zones_answered: boolean | null;
  zones: WizardDogPolicyZone[];
  dining_zones_answered: boolean | null;
  dining_zone_ids: number[];
}

export interface WizardDogPolicyUnit {
  room_id: number;
  name: string;
  site_unit_name: string | null;
  is_full_use: boolean;
  is_active: boolean;
  policy: WizardDogPolicy;
  /** Fields still required to confirm step 3 ("zones.8.other_text"...). */
  missing: string[];
}

export interface WizardDogPolicyPayload {
  max_pets: number | null;
  max_pets_unlimited: boolean;
  max_pets_answered: boolean;
  units: WizardDogPolicyUnit[];
}

/**
 * Answer of one dog supply / additional service (step 4). Items without a
 * stored row are "unanswered" with the rest null. price/pricing_mode only
 * when state = yes and is_paid = true.
 */
export interface WizardServiceAnswer {
  state: AnswerStateValue;
  is_paid: boolean | null;
  price: number | null;
  pricing_mode: ServicePricingModeValue | null;
}

export interface WizardDogSupplyAnswer extends WizardServiceAnswer {
  supply_id: number;
}

export interface WizardAdditionalServiceAnswer extends WizardServiceAnswer {
  service_id: number;
}

/**
 * GET row of step 4. prefilled = true when there is no stored answer and
 * the item was derived as "yes" from the legacy jsites1.tipspec.
 */
export interface WizardServiceRow extends WizardServiceAnswer {
  prefilled: boolean;
}

export interface WizardDogSupplyRow extends WizardServiceRow {
  supply_id: number;
}

export interface WizardAdditionalServiceRow extends WizardServiceRow {
  service_id: number;
}

/** jsites1 feature column (namesql) -> selected option ids. */
export type WizardFeatures = Record<string, number[]>;

export interface WizardServicesPayload {
  dog_supplies: WizardDogSupplyRow[];
  additional_services: WizardAdditionalServiceRow[];
  features: WizardFeatures;
  tipserv: number[];
  /** Selected ids among the manual tipspec extras (7, 8, 21). */
  tipspec_extra: number[];
}

/** PUT body of step 4: only the keys present are updated. */
export interface WizardServicesUpdate {
  dog_supplies?: WizardDogSupplyAnswer[];
  additional_services?: WizardAdditionalServiceAnswer[];
  features?: WizardFeatures;
  tipserv?: number[];
  tipspec_extra?: number[];
}

/** One non-empty photo slot of v4p_jsites2 (image1 = cover). */
export interface WizardContentImage {
  slot: number;
  file: string;
}

/** Step 5 "Contenido" (photos are uploaded by PHP). */
export interface WizardContentPayload {
  /** Plain text (description1_l1). */
  description_short: string;
  /** Sanitized HTML (description2_l1). */
  description_long: string;
  images: WizardContentImage[];
  /** v4p_jsites1.premium (0 = free). */
  premium: number;
  /** Photo slots available for the plan (legacy photo tab rule). */
  max_photos: number;
}

export interface WizardAvailabilitySettings {
  configured: boolean;
  mode: string | null;
  min_nights: number | null;
  max_nights: number | null;
}

/** Step 6 "Reservas". */
export interface WizardBookingSettingsPayload {
  availability: WizardAvailabilitySettings;
  /** Active units the availability applies to. */
  rooms_count: number;
}

export interface WizardCompletenessItem {
  key: string;
  step: number;
  label: string;
  required: boolean;
  done: boolean;
}

export interface WizardCompleteness {
  percent: number;
  items: WizardCompletenessItem[];
}

export interface WizardMissingItem {
  key: string;
  step: number;
  label: string;
}

export interface WizardScoreBlock {
  points: number;
  max: number;
}

export interface WizardScoreBlocks {
  policy: WizardScoreBlock;
  services: WizardScoreBlock;
  integration: WizardScoreBlock;
}

export interface WizardReviewsSummary {
  count: number;
  average: number | null;
}

export interface WizardScore {
  /** Objective part O (blocks 1-3 / 41 * 100), 1 decimal. */
  objective: number;
  /** Final Dog Friendly Score, 1 decimal. */
  score: number;
  /** 2..5, computed on the unrounded score, veto applied. */
  paws: number;
  blocks: WizardScoreBlocks;
  reviews: WizardReviewsSummary;
}

export interface WizardReviewStatus {
  submitted_at: string | null;
  terms_accepted_at: string | null;
  terms_version: string | null;
  /** v4p_jsites1.active = 'S' (set by admin, never by the wizard). */
  active: boolean;
}

/** Step 7 "Revisión". */
export interface WizardReviewPayload {
  completeness: WizardCompleteness;
  score: WizardScore;
  can_publish: boolean;
  missing_required: WizardMissingItem[];
  status: WizardReviewStatus;
}
