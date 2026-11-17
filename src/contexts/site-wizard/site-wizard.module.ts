import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { LegacyDbModule } from "@/shared/legacy-db/legacy-db.module";

import { AdditionalServiceEntity } from "@/contexts/additional-services/entities/additional-service.entity";
import { SiteAdditionalServiceEntity } from "@/contexts/additional-services/entities/site-additional-service.entity";
import { AvailabilityEntity } from "@/contexts/availability/entities/availability.entity";
import { CommonZoneEntity } from "@/contexts/common-zones/entities/common-zone.entity";
import { DogSizeEntity } from "@/contexts/dog-sizes/entities/dog-size.entity";
import { DogSupplyEntity } from "@/contexts/dog-supplies/entities/dog-supply.entity";
import { SiteDogSupplyEntity } from "@/contexts/dog-supplies/entities/site-dog-supply.entity";
import { GeographyModule } from "@/contexts/geography/geography.module";
import { PaymentsModule } from "@/contexts/payments/payments.module";
import { UnitPetPolicyEntity } from "@/contexts/pet-policies/entities/unit-pet-policy.entity";
import { UnitPetPolicyZoneEntity } from "@/contexts/pet-policies/entities/unit-pet-policy-zone.entity";
import { ReservationEntity } from "@/contexts/reservations/entities/reservation.entity";
import { ReservationGuestFeedbackEntity } from "@/contexts/reservations/entities/reservation-guest-feedback.entity";
import { RoomEntity } from "@/contexts/rooms/entities/room.entity";
import { RoomsModule } from "@/contexts/rooms/rooms.module";
import { SiteHistoryModule } from "@/contexts/site-history/site-history.module";
import { SiteUnitEntity } from "@/contexts/site-unit/entities/site-unit.entity";
import { SpeciesEntity } from "@/contexts/species/entities/species.entity";
import { StripeModule } from "@/contexts/stripe/stripe.module";

import { SiteWizardController } from "./api/site-wizard.controller";
import { SiteSettingsEntity } from "./entities/site-settings.entity";
import { SiteBookingSettingsWizardService } from "./services/site-booking-settings-wizard.service";
import { SiteContentWizardService } from "./services/site-content-wizard.service";
import { SiteDogPolicyWizardService } from "./services/site-dog-policy-wizard.service";
import { SiteReviewWizardService } from "./services/site-review-wizard.service";
import { SiteServicesWizardService } from "./services/site-services-wizard.service";
import { SiteUnitsWizardService } from "./services/site-units-wizard.service";
import { SiteWizardService } from "./services/site-wizard.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SiteSettingsEntity,
      RoomEntity,
      SiteUnitEntity,
      UnitPetPolicyEntity,
      UnitPetPolicyZoneEntity,
      DogSizeEntity,
      CommonZoneEntity,
      SpeciesEntity,
      DogSupplyEntity,
      SiteDogSupplyEntity,
      AdditionalServiceEntity,
      SiteAdditionalServiceEntity,
      AvailabilityEntity,
      ReservationEntity,
      ReservationGuestFeedbackEntity,
    ]),
    LegacyDbModule,
    GeographyModule,
    PaymentsModule,
    RoomsModule,
    SiteHistoryModule,
    StripeModule,
  ],
  controllers: [SiteWizardController],
  providers: [
    SiteWizardService,
    SiteUnitsWizardService,
    SiteDogPolicyWizardService,
    SiteServicesWizardService,
    SiteContentWizardService,
    SiteBookingSettingsWizardService,
    SiteReviewWizardService,
  ],
  exports: [SiteWizardService],
})
export class SiteWizardModule {}
