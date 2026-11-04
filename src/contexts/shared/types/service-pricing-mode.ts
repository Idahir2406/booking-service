// How a paid dog supply / additional service is charged (wizard step 4).
// Stored in site_dog_supplies.pricing_mode / site_additional_services.pricing_mode.
export const service_pricing_mode_values = [
  "per_stay",
  "per_night",
  "per_pet_night",
  "per_pet_stay",
] as const;
export type ServicePricingModeValue =
  (typeof service_pricing_mode_values)[number];
