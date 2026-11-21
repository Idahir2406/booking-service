import type { AccommodationProvider } from "../domain/accommodation-provider.port";
import type { ProviderName } from "../domain/provider.types";

import { Injectable } from "@nestjs/common";

import { NuiteeProvider } from "../infrastructure/nuitee/nuitee.provider";

/**
 * Providers by name ('nuitee' today; HyperGuest later). Reservations store
 * `source` = provider name, so services resolve the adapter from it.
 */
@Injectable()
export class AccommodationProviderRegistry {
  private readonly providers: ReadonlyMap<ProviderName, AccommodationProvider>;

  constructor(nuitee: NuiteeProvider) {
    this.providers = new Map<ProviderName, AccommodationProvider>([
      [nuitee.name, nuitee],
    ]);
  }

  has(name: string): name is ProviderName {
    return this.providers.has(name as ProviderName);
  }

  /** Throws when the provider is unknown. */
  get(name: string): AccommodationProvider {
    const provider = this.providers.get(name as ProviderName);
    if (!provider) {
      throw new Error(`Unknown accommodation provider: ${name}`);
    }
    return provider;
  }

  names(): ProviderName[] {
    return [...this.providers.keys()];
  }
}
