import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { SiteAdditionalServiceEntity } from "../additional-services/entities/site-additional-service.entity";
import { AvailabilityModule } from "../availability/availability.module";
import { BlocksModule } from "../blocks/blocks.module";
import { DogSizeEntity } from "../dog-sizes/entities/dog-size.entity";
import { SiteDogSupplyEntity } from "../dog-supplies/entities/site-dog-supply.entity";
import { MailModule } from "../mail/mail.module";
import { HostPayoutFailureEntity } from "../payments/entities/host-payout-failure.entity";
import { PaymentEntity } from "../payments/entities/payment.entity";
import { RefundEntity } from "../payments/entities/refund.entity";
import { ReservationSnapshotEntity } from "../payments/entities/reservation-snapshot.entity";
import { PaymentsModule } from "../payments/payments.module";
import { UnitPetPolicyEntity } from "../pet-policies/entities/unit-pet-policy.entity";
import { RoomsModule } from "../rooms/rooms.module";
import { MysqlService } from "../shared/services/mysql.service";
import { SiteSettingsEntity } from "../site-wizard/entities/site-settings.entity";
import { SpeciesEntity } from "../species/entities/species.entity";
import { StripeModule } from "../stripe/stripe.module";
import { TravelerDogsModule } from "../traveler-dogs/traveler-dogs.module";
import { HostPayoutsController } from "./api/host-payouts.controller";
import { IncidentsAdminController } from "./api/incidents-admin.controller";
import { RefundsController } from "./api/refunds.controller";
import { ReservationController } from "./api/reservation.controller";
import {
  ReservationAlternativesAdminController,
  ReservationChangesAdminController,
} from "./api/reservation-changes-admin.controller";
import { ReservationsAdminController } from "./api/reservations-admin.controller";
import { TravelerPanelController } from "./api/traveler-panel.controller";
import { ReservationEntity } from "./entities/reservation.entity";
import { ReservationAlternativeEntity } from "./entities/reservation-alternative.entity";
import { ReservationChangeProposalEntity } from "./entities/reservation-change-proposal.entity";
import { ReservationChangeRequestEntity } from "./entities/reservation-change-request.entity";
import { ReservationDisputeEntity } from "./entities/reservation-dispute.entity";
import { ReservationEventEntity } from "./entities/reservation-event.entity";
import { ReservationFeedbackTokenEntity } from "./entities/reservation-feedback-token.entity";
import { ReservationGuestFeedbackEntity } from "./entities/reservation-guest-feedback.entity";
import { ReservationIncidentEntity } from "./entities/reservation-incident.entity";
import { ReservationIncidentAttachmentEntity } from "./entities/reservation-incident-attachment.entity";
import { ReservationIncidentMessageEntity } from "./entities/reservation-incident-message.entity";
import { HostPayoutBlockService } from "./services/host-payout-block.service";
import { ReservationService } from "./services/reservation.service";
import { ReservationAlternativeService } from "./services/reservation-alternative.service";
import { ReservationChangeService } from "./services/reservation-change.service";
import { ReservationChangeApplyService } from "./services/reservation-change-apply.service";
import { ReservationChangeQueryService } from "./services/reservation-change-query.service";
import { ReservationDeferredChargeService } from "./services/reservation-deferred-charge.service";
import { ReservationEmailService } from "./services/reservation-email.service";
import { ReservationEmailTemplateService } from "./services/reservation-email-template.service";
import { ReservationEventService } from "./services/reservation-event.service";
import { ReservationFeedbackService } from "./services/reservation-feedback.service";
import { ReservationHistoryService } from "./services/reservation-history.service";
import { ReservationHostCannotHostService } from "./services/reservation-host-cannot-host.service";
import { ReservationIncidentService } from "./services/reservation-incident.service";
import { ReservationIncidentAdminService } from "./services/reservation-incident-admin.service";
import { ReservationIncidentNotificationService } from "./services/reservation-incident-notification.service";
import { ReservationLifecycleService } from "./services/reservation-lifecycle.service";
import { ReservationNoShowService } from "./services/reservation-no-show.service";
import { ReservationPayoutService } from "./services/reservation-payout.service";
import { ReservationQuoteContextService } from "./services/reservation-quote-context.service";
import { ReservationRefundService } from "./services/reservation-refund.service";
import { TravelerIncidentInboxService } from "./services/traveler-incident-inbox.service";
import { TravelerReservationPanelService } from "./services/traveler-reservation-panel.service";
import { TravelerReservationPayService } from "./services/traveler-reservation-pay.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReservationEntity,
      ReservationFeedbackTokenEntity,
      ReservationGuestFeedbackEntity,
      ReservationDisputeEntity,
      ReservationEventEntity,
      RefundEntity,
      // F-PV1 traveler panel: read-only payment history + list snapshots
      PaymentEntity,
      ReservationSnapshotEntity,
      // F-PV7a traveler incidents (D4)
      ReservationIncidentEntity,
      ReservationIncidentAttachmentEntity,
      ReservationIncidentMessageEntity,
      // F-PV7b change requests / proposals / alternatives
      ReservationChangeRequestEntity,
      ReservationChangeProposalEntity,
      ReservationAlternativeEntity,
      // F2 quote/checkout: read-only wizard data (dog policy, sizes, services)
      SpeciesEntity,
      DogSizeEntity,
      UnitPetPolicyEntity,
      SiteSettingsEntity,
      SiteDogSupplyEntity,
      SiteAdditionalServiceEntity,
      // Punto 9: Stripe payout.failed on host accounts
      HostPayoutFailureEntity,
    ]),
    AvailabilityModule,
    BlocksModule,
    RoomsModule,
    MailModule,
    PaymentsModule,
    // F-PV6 dashboard: saved dogs (TravelerDogsService is exported)
    TravelerDogsModule,
    forwardRef(() => StripeModule),
  ],
  controllers: [
    ReservationController,
    HostPayoutsController,
    RefundsController,
    TravelerPanelController,
    IncidentsAdminController,
    ReservationsAdminController,
    ReservationChangesAdminController,
    ReservationAlternativesAdminController,
  ],
  providers: [
    ReservationService,
    ReservationEmailService,
    ReservationEmailTemplateService,
    ReservationPayoutService,
    ReservationLifecycleService,
    ReservationRefundService,
    ReservationFeedbackService,
    ReservationEventService,
    ReservationQuoteContextService,
    TravelerReservationPanelService,
    TravelerReservationPayService,
    ReservationIncidentService,
    // Incident chat (2026-10-25): emails on every message + "Incidencias" tab
    ReservationIncidentNotificationService,
    TravelerIncidentInboxService,
    // Backoffice fase 1: admino incidents inbox (read side)
    ReservationIncidentAdminService,
    ReservationChangeQueryService,
    ReservationChangeApplyService,
    ReservationChangeService,
    ReservationAlternativeService,
    // Punto 9: pause new reservations after payout_failure_days of failed payouts
    HostPayoutBlockService,
    // Punto 6: host-reported no-show reviewed by V4P
    ReservationNoShowService,
    ReservationHostCannotHostService,
    ReservationHistoryService,
    // Fase 4: off-session deferred charge + regularization crons
    ReservationDeferredChargeService,
    MysqlService,
  ],
  exports: [
    HostPayoutBlockService,
    ReservationService,
    ReservationEmailService,
    ReservationPayoutService,
    ReservationLifecycleService,
    ReservationRefundService,
    ReservationFeedbackService,
    ReservationEventService,
    ReservationDeferredChargeService,
  ],
})
export class ReservationModule {}
