export interface CatalogOption {
  id: number;
  name: string;
}

export interface TipsiteOption extends CatalogOption {
  id_parent: number;
  depth: number;
}

export interface GeneratedField {
  namesql: string;
  label: string;
  description: string;
  type: string;
  validation_type: string | null;
  required: boolean;
}

/** Unit type of a tipsite (site_units catalog), step 2 "Unidades". */
export interface SiteUnitOption {
  id: number;
  tipsite_id: number;
  name: string;
  slug: string;
  is_full_use: boolean;
  sort_order: number;
}

export interface CodeLabelOption {
  code: string;
  label: string;
}

/** Dog size (species "Perro"), cumulative by rank; max_kg null = no limit. */
export interface DogSizeOption {
  id: number;
  name: string;
  slug: string;
  rank: number;
  min_kg: number;
  max_kg: number | null;
}

/** Common zone a dog may access (step 3). */
export interface CommonZoneOption {
  id: number;
  slug: string;
  name: string;
  is_dining_capable: boolean;
  requires_text: boolean;
  sort_order: number;
}

export interface SiteFormCatalog {
  tipsite: TipsiteOption[];
  tipo_de_alquiler: CatalogOption[];
  tipenv: CatalogOption[];
  tipdest: CatalogOption[];
  generated_fields: GeneratedField[];
  site_units: SiteUnitOption[];
  board_codes: CodeLabelOption[];
  extra_pricing_modes: CodeLabelOption[];
  dog_sizes: DogSizeOption[];
  common_zones: CommonZoneOption[];
  supplement_modes: CodeLabelOption[];
  left_alone_options: CodeLabelOption[];
  deposit_return_options: CodeLabelOption[];
  dog_supplies: DogSupplyOption[];
  additional_services: AdditionalServiceOption[];
  service_pricing_modes: CodeLabelOption[];
  feature_groups: FeatureGroupOption[];
  tipserv: CatalogOption[];
  tipspec_extra: TipspecExtraOption[];
}

/** Dog supply (amenity / facility) of species "Perro" (step 4). */
export interface DogSupplyOption {
  id: number;
  name: string;
  slug: string;
  section: string;
  sort_order: number;
}

/** Additional service of species "Perro" (step 4). */
export interface AdditionalServiceOption {
  id: number;
  name: string;
  slug: string;
  sort_order: number;
}

/** Generated multioption field of v4p_jsites1 (step 4). */
export interface FeatureGroupOption {
  namesql: string;
  label: string;
  block: string;
  multiple: boolean;
  options: CatalogOption[];
}

/** Manual v4p_jtipspec extra (7, 8, 21); description = name_l1 without HTML. */
export interface TipspecExtraOption {
  id: number;
  label: string;
  description: string;
}
