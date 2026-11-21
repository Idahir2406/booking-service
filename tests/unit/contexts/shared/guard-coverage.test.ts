import { readdirSync } from "node:fs";
import path from "node:path";

import { RequestMethod } from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";

import { InternalApiKeyGuard } from "@/src/contexts/shared/guards/internal-api-key.guard";

/**
 * F0: every HTTP route must be behind InternalApiKeyGuard except this
 * explicit list of traveler-facing / infrastructure routes. Adding a public
 * route requires updating this list (and the F0 doc) on purpose.
 */
const PUBLIC_ROUTES = [
  "GET health",
  "POST webhook",
  "POST providers/nuitee/webhook",
  "GET reservations/public/rooms/:room_id/calendar",
  "GET reservations/feedback/:token",
  "POST reservations/feedback/:token",
  "POST reservations/quote",
  "POST reservations/checkout",
  "GET reservations/:id",
  "GET rooms/by-site/:site_id/public",
].sort();

type Constructor = abstract new (...args: never[]) => unknown;

const SRC_DIR = path.resolve(__dirname, "../../../../src");

function findControllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return findControllerFiles(full);
    }
    return entry.name.endsWith(".controller.ts") ? [full] : [];
  });
}

function joinPath(...parts: unknown[]): string {
  return parts
    .flatMap((part): unknown[] => (Array.isArray(part) ? part : [part]))
    .map(part => String(part ?? "").replaceAll(/^\/+|\/+$/g, ""))
    .filter(part => part !== "")
    .join("/");
}

function hasInternalGuard(target: object): boolean {
  const guards = Reflect.getMetadata(GUARDS_METADATA, target) as
    | unknown[]
    | undefined;
  return (guards ?? []).includes(InternalApiKeyGuard);
}

interface RouteInfo {
  route: string;
  guarded: boolean;
}

async function collectRoutes(): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];
  for (const file of findControllerFiles(SRC_DIR)) {
    // eslint-disable-next-line node/no-unsupported-features/es-syntax -- vitest ESM loader
    const moduleExports = (await import(file)) as Record<string, unknown>;
    for (const exported of Object.values(moduleExports)) {
      if (typeof exported !== "function") {
        continue;
      }
      const controller = exported as Constructor;
      const basePath: unknown = Reflect.getMetadata(PATH_METADATA, controller);
      if (basePath === undefined) {
        continue;
      }
      const classGuarded = hasInternalGuard(controller);
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (name === "constructor" || typeof handler !== "function") {
          continue;
        }
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          | RequestMethod
          | undefined;
        if (method === undefined) {
          continue;
        }
        const routePath: unknown = Reflect.getMetadata(PATH_METADATA, handler);
        routes.push({
          route: `${RequestMethod[method]} ${joinPath(basePath, routePath)}`,
          guarded: classGuarded || hasInternalGuard(handler),
        });
      }
    }
  }
  return routes;
}

describe("InternalApiKeyGuard coverage", () => {
  it("guards every route except the explicit public list", async () => {
    const routes = await collectRoutes();
    expect(routes.length).toBeGreaterThan(40);

    const publicRoutes = routes
      .filter(route => !route.guarded)
      .map(route => route.route)
      .sort();

    expect(publicRoutes).toEqual(PUBLIC_ROUTES);
  });

  it("no longer exposes PATCH/DELETE reservations/:id", async () => {
    const collected = await collectRoutes();
    const routes = collected.map(route => route.route);

    expect(routes).not.toContain("PATCH reservations/:id");
    expect(routes).not.toContain("DELETE reservations/:id");
  });

  it("keeps host money/state routes internal", async () => {
    const routes = await collectRoutes();
    const byRoute = new Map(routes.map(route => [route.route, route.guarded]));

    for (const route of [
      "GET reservations/by-site/:site_id/range",
      "POST reservations/:id/cancel",
      "POST reservations/:id/cancel-traveler",
      "POST reservations/:id/exceptional-refund",
      "POST refunds/:refund_id/review",
      "POST reservations/:id/finalize",
      "POST reservations",
      "POST stripe/express-account",
      "POST stripe/dashboard-link",
      "GET hosts/:user_id/payout-block",
      "POST reservations/:id/no-show",
      "POST incidents/:incident_id/no-show/resolve",
      "GET stripe/connect-status/:user_id",
      "POST stripe/site-payment-link",
      "POST mail/test",
      "GET traveler/:user_id/reservations",
      "GET traveler/:user_id/reservations/:id",
      "POST traveler/:user_id/reservations/:id/feedback-token",
      "POST traveler/:user_id/reservations/:id/cancel-preview",
      "POST traveler/:user_id/reservations/:id/pay",
      "GET traveler/:user_id/dogs",
      "POST traveler/:user_id/dogs",
      "PATCH traveler/:user_id/dogs/:dog_id",
      "DELETE traveler/:user_id/dogs/:dog_id",
      "GET traveler/:user_id/dashboard",
      "GET traveler/:user_id/reservations/:id/incidents",
      "POST traveler/:user_id/reservations/:id/incidents",
      "POST traveler/:user_id/incidents/:incident_id/attachments",
      "POST traveler/:user_id/incidents/:incident_id/messages",
      "GET traveler/:user_id/incidents/:incident_id/attachments/:attachment_id",
      // "Incidencias" tab (chat)
      "GET traveler/:user_id/incidents",
      "GET traveler/:user_id/incidents/:incident_id",
      "POST incidents/:incident_id/status",
      "POST incidents/:incident_id/messages",
      // Backoffice fase 1 (admino incidents inbox)
      "GET incidents",
      "GET incidents/:incident_id",
      "GET incidents/:incident_id/attachments/:attachment_id",
      // F-PV7b change requests / proposals / alternatives
      "GET traveler/:user_id/reservations/:id/change-requests",
      "POST traveler/:user_id/reservations/:id/change-requests",
      "POST traveler/:user_id/change-requests/:request_id/cancel",
      "POST traveler/:user_id/change-proposals/:proposal_id/accept",
      "POST traveler/:user_id/change-proposals/:proposal_id/reject",
      "POST traveler/:user_id/alternatives/:alternative_id/accept",
      "POST traveler/:user_id/alternatives/:alternative_id/reject",
      "GET reservation-changes",
      "GET reservation-changes/:request_id",
      "POST reservation-changes/:request_id/status",
      "POST reservation-changes/:request_id/quote",
      "POST reservation-changes/:request_id/proposals",
      "POST reservation-alternatives/:reservation_id/quote",
      "POST reservation-alternatives/:reservation_id",
    ]) {
      expect(byRoute.get(route)).toBe(true);
    }
  });
});
