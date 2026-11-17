import type {
  WizardBookingSettingsPayload,
  WizardContentPayload,
  WizardDogPolicyPayload,
  WizardServicesPayload,
  WizardUnit,
  WizardUnitsPayload,
} from "../types/site-wizard.types";

/**
 * What of each wizard payload goes to the accommodation history (only the
 * business data the host decides; derived/bookkeeping fields are dropped so
 * they never show up as "changes").
 */

export type AuditableUnit = Omit<WizardUnit, "sort_order" | "site_unit_id">;

export function auditableUnit(
  unit: WizardUnit | undefined,
): AuditableUnit | undefined {
  if (!unit) {
    return undefined;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped on purpose
  const { sort_order, site_unit_id, ...rest } = unit;
  return rest;
}

export function findUnit(
  payload: WizardUnitsPayload,
  roomId: number,
): WizardUnit | undefined {
  return payload.units.find(unit => unit.id === roomId);
}

export function auditableMaxPets(payload: WizardDogPolicyPayload) {
  return {
    max_pets: payload.max_pets,
    max_pets_unlimited: payload.max_pets_unlimited,
  };
}

export function auditableUnitDogPolicy(
  payload: WizardDogPolicyPayload,
  roomId: number,
) {
  return payload.units.find(unit => unit.room_id === roomId)?.policy;
}

export function unitDogPolicyName(
  payload: WizardDogPolicyPayload,
  roomId: number,
): string | null {
  return payload.units.find(unit => unit.room_id === roomId)?.name ?? null;
}

/** `prefilled` flips when the host saves: never a business change. */
function withoutPrefilled<T extends { prefilled: boolean }>(
  row: T,
): Omit<T, "prefilled"> {
  const copy: Partial<T> = { ...row };
  delete copy.prefilled;
  return copy as Omit<T, "prefilled">;
}

export function auditableServices(payload: WizardServicesPayload) {
  return {
    dog_supplies: payload.dog_supplies.map(row => withoutPrefilled(row)),
    additional_services: payload.additional_services.map(row =>
      withoutPrefilled(row),
    ),
    features: payload.features,
    tipserv: payload.tipserv,
    tipspec_extra: payload.tipspec_extra,
    cribs: payload.cribs,
  };
}

export function auditableContent(payload: WizardContentPayload) {
  return {
    description_short: payload.description_short,
    description_long: payload.description_long,
  };
}

export function auditableBookingSettings(
  payload: WizardBookingSettingsPayload,
) {
  return {
    availability: payload.availability,
    cancellation: payload.cancellation,
    schedule: payload.schedule,
  };
}
