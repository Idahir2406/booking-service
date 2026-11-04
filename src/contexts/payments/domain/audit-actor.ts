/** Who performed an economic action (B1/B14). */
export const ACTOR_TYPE = {
  SYSTEM: "system",
  TRAVELER: "traveler",
  HOST: "host",
  ADMIN: "admin",
  STRIPE: "stripe",
} as const;

export type ActorType = (typeof ACTOR_TYPE)[keyof typeof ACTOR_TYPE];

export const ACTOR_TYPES = Object.values(ACTOR_TYPE);

export interface Actor {
  type: ActorType;
  /** user id, `site:{id}`, Stripe event id, cron name... */
  id: string | null;
}

export const actors = {
  system: (id: string | null = null): Actor => ({
    type: ACTOR_TYPE.SYSTEM,
    id,
  }),
  traveler: (id: number | string | null | undefined): Actor => ({
    type: ACTOR_TYPE.TRAVELER,
    id: id === null || id === undefined || id === 0 ? null : String(id),
  }),
  host: (siteId: number | string | null | undefined): Actor => ({
    type: ACTOR_TYPE.HOST,
    id:
      siteId === null || siteId === undefined ? null : `site:${String(siteId)}`,
  }),
  admin: (id: number | string | null = null): Actor => ({
    type: ACTOR_TYPE.ADMIN,
    id: id === null ? null : String(id),
  }),
  stripe: (eventId: string | null = null): Actor => ({
    type: ACTOR_TYPE.STRIPE,
    id: eventId,
  }),
} as const;
