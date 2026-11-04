# Inventario de archivos — Sistema de reservas viajes4patas

> Fecha: 2026-10-26 · Generado de forma automática con `fd`/`rg` sobre el disco (no de memoria) y propósitos extraídos del primer comentario de cabecera de cada archivo (o del nombre de la clase exportada). Si un archivo no tiene comentario se marca `—`.

## Qué incluye

- **A. `booking/`** (API NestJS): es el sistema de reservas completo → se lista **todo** `booking/src`, `booking/tests`, `booking/docs` y la configuración raíz (sin leer `.env`).
- **B. `web/`** (PHP legacy): archivos que participan en la reserva pública, cuenta del viajero, panel del anfitrión, wizard de alta, proxies a la API, emails, backoffice `admino`, rutas `.htaccess` y login/sesión.
- **C. `booking-frontend/`**: deprecado; verificado que ya **no existe** en disco.
- **D. Otras carpetas raíz** revisadas (`image-optimizer/`, `uploads-files/`, `v4p-translations/`): sin archivos del flujo de reservas (ver exclusiones).

Etiquetas: `[PV]` = archivo citado en los docs del panel viajero (`docs/panel-viajero/*`), `[BO]` = citado en el doc de backoffice (`docs/backoffice/*`). Coincidencia por nombre de archivo; orientativa.

### Comandos usados

```bash
fd -t f . booking/src booking/tests booking/docs
fd -t f -d1 -H . booking -E .env -E .env.test
fd -t f . booking/src/database/migrations | sort
rg -l -i -e reserv -e booking -e bw_api_request -e traveler -e stripe -e checkout -e incident -e admOps \
   -e platform_commission -e refund -e socprofile -e usprofile -e ussitecreate -e mi-cuenta -e mi-reserva \
   -e fsc_ -e rbw -e '\bnrf' -e cv_ web/  (excluyendo php/stripe, tinymce, images, build, *.min.*, *.sql, sitemaps, backups)
rg -n -i 'reserv|mi-cuenta|mi-reserva|socperf|usprofile|ussitecreate' web/.htaccess web/production-htaccess
fd booking-frontend -d2   # → sin resultados
```

## Conteo

| Sección                                                                   |                                             Archivos |
| ------------------------------------------------------------------------- | ---------------------------------------------------: |
| Booking API · reservations                                                |                                                   69 |
| Booking API · payments                                                    |                                                   29 |
| Booking API · stripe                                                      |                                                    8 |
| Booking API · webhook                                                     |                                                    7 |
| Booking API · availability                                                |                                                    6 |
| Booking API · blocks                                                      |                                                    6 |
| Booking API · rooms                                                       |                                                   14 |
| Booking API · site-wizard                                                 |                                                   20 |
| Booking API · traveler-dogs                                               |                                                    6 |
| Booking API · pet-policies                                                |                                                    4 |
| Booking API · mail                                                        |                                                    6 |
| Booking API · shared                                                      |                                                   21 |
| Booking API · additional-services                                         |                                                    3 |
| Booking API · catalogs                                                    |                                                    6 |
| Booking API · closest-services                                            |                                                    3 |
| Booking API · common-zones                                                |                                                    2 |
| Booking API · dog-sizes                                                   |                                                    2 |
| Booking API · dog-supplies                                                |                                                    3 |
| Booking API · faq                                                         |                                                    3 |
| Booking API · geography                                                   |                                                    5 |
| Booking API · site-unit                                                   |                                                    2 |
| Booking API · species                                                     |                                                    2 |
| Booking API · núcleo (main, app, database, types, rooms legacy)           |                                                    7 |
| Booking API · Migraciones (orden cronológico)                             |                                                   42 |
| Booking API · Tests                                                       |                                                   51 |
| Booking API · Docs                                                        |                                                   12 |
| Booking API · Configuración raíz (solo nombres)                           |                                                   36 |
| Web · Reserva pública (/reservar, retorno Stripe, feedback, confirmación) |                                                   28 |
| Web · Panel viajero / cuenta unificada                                    |                                                   25 |
| Web · Panel anfitrión (reservas, habitaciones, Stripe Connect, perfil)    |                                                   24 |
| Web · Wizard alta alojamiento (/registrar-alojamiento, fsc\_)             |                                                   15 |
| Web · Proxies PHP → API Nest                                              |                                                    4 |
| Web · Emails de reservas y cola                                           |                                                    9 |
| Web · Librerías inc/ y conexión                                           |                                                   12 |
| Web · Admino backoffice                                                   |                                                   12 |
| Web · Rutas (.htaccess)                                                   |                                                    3 |
| Web · Login / sesión (gating de paneles)                                  |                                                   18 |
| Web · Docs (claves jvariables)                                            |                                                    5 |
| Web · Vendor                                                              |                                                    1 |
| Deprecado (booking-frontend)                                              |                                      1 (no en disco) |
| **Booking API (src + tests + docs)**                                      |                                              **339** |
| **Booking config raíz**                                                   |                                               **36** |
| **Web**                                                                   | **156** (incluye 1 fila agregada para el SDK Stripe) |
| **TOTAL filas**                                                           |                                              **532** |

Autochequeo: `fd -t f . booking/src booking/tests booking/docs | wc -l` = **339** (sin contar este inventario) · filas booking (src+tests+docs) = **339**. ✔ cobertura 100%.

## Booking API · reservations

### (raíz del contexto)

| Archivo                                                                                                                | Propósito                       |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| [`booking/src/contexts/reservations/reservation.module.ts`](../src/contexts/reservations/reservation.module.ts) `[PV]` | Módulo Nest `ReservationModule` |

### api

| Archivo                                                                                                                                                            | Propósito                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| [`booking/src/contexts/reservations/api/incidents-admin.controller.ts`](../src/contexts/reservations/api/incidents-admin.controller.ts) `[PV]`                     | Controller HTTP `IncidentsAdminController`          |
| [`booking/src/contexts/reservations/api/refunds.controller.ts`](../src/contexts/reservations/api/refunds.controller.ts)                                            | Controller HTTP `RefundsController`                 |
| [`booking/src/contexts/reservations/api/reservation-changes-admin.controller.ts`](../src/contexts/reservations/api/reservation-changes-admin.controller.ts) `[PV]` | Controller HTTP `ReservationChangesAdminController` |
| [`booking/src/contexts/reservations/api/reservation.controller.ts`](../src/contexts/reservations/api/reservation.controller.ts) `[PV]`                             | Controller HTTP `ReservationController`             |
| [`booking/src/contexts/reservations/api/traveler-panel.controller.ts`](../src/contexts/reservations/api/traveler-panel.controller.ts) `[PV]`                       | Controller HTTP `TravelerPanelController`           |

### dto

| Archivo                                                                                                                                                          | Propósito                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [`booking/src/contexts/reservations/dto/cancel-reservation.dto.ts`](../src/contexts/reservations/dto/cancel-reservation.dto.ts)                                  | DTO `CancelReservationDto`                                                                                     |
| [`booking/src/contexts/reservations/dto/checkout-reservation.dto.ts`](../src/contexts/reservations/dto/checkout-reservation.dto.ts)                              | DTO `CheckoutReservationDto`                                                                                   |
| [`booking/src/contexts/reservations/dto/create-reservation.dto.ts`](../src/contexts/reservations/dto/create-reservation.dto.ts)                                  | DTO `CreateReservationDto`                                                                                     |
| [`booking/src/contexts/reservations/dto/exceptional-refund-request.dto.ts`](../src/contexts/reservations/dto/exceptional-refund-request.dto.ts)                  | DTO `ExceptionalRefundRequestDto`                                                                              |
| [`booking/src/contexts/reservations/dto/feedback-summary.dto.ts`](../src/contexts/reservations/dto/feedback-summary.dto.ts)                                      | DTO `FeedbackSummaryDto`                                                                                       |
| [`booking/src/contexts/reservations/dto/finalize-reservation.dto.ts`](../src/contexts/reservations/dto/finalize-reservation.dto.ts)                              | DTO `FinalizeReservationDto`                                                                                   |
| [`booking/src/contexts/reservations/dto/incident-admin.dto.ts`](../src/contexts/reservations/dto/incident-admin.dto.ts)                                          | DTO `ListIncidentsQueryDto` — Query of 'GET /v1/incidents' (internal, admino inbox).                           |
| [`booking/src/contexts/reservations/dto/public-room-calendar.dto.ts`](../src/contexts/reservations/dto/public-room-calendar.dto.ts)                              | DTO `PublicAvailabilityDay` — Public (traveler-facing) room calendar. Only what the date picker needs:         |
| [`booking/src/contexts/reservations/dto/quote-reservation.dto.ts`](../src/contexts/reservations/dto/quote-reservation.dto.ts)                                    | DTO `ReservationDogDto` — F2 (B2): one traveler dog. Size is derived server-side from the weight.              |
| [`booking/src/contexts/reservations/dto/reservation-change.dto.ts`](../src/contexts/reservations/dto/reservation-change.dto.ts) `[PV]`                           | DTO `CreateChangeRequestDto` — Body of 'POST /v1/traveler/:user_id/reservations/:id/change-requests'.          |
| [`booking/src/contexts/reservations/dto/reservation-incident.dto.ts`](../src/contexts/reservations/dto/reservation-incident.dto.ts) `[PV]`                       | DTO `CreateIncidentDto` — Body of 'POST /v1/traveler/:user_id/reservations/:id/incidents'.                     |
| [`booking/src/contexts/reservations/dto/reservation-public-summary.dto.ts`](../src/contexts/reservations/dto/reservation-public-summary.dto.ts)                  | DTO `ReservationPublicSummaryDto` — Traveler-facing summary for the post-checkout success page. Only returned  |
| [`booking/src/contexts/reservations/dto/reservation-with-room.dto.ts`](../src/contexts/reservations/dto/reservation-with-room.dto.ts)                            | DTO `ReservationWithRoomName`                                                                                  |
| [`booking/src/contexts/reservations/dto/submit-feedback.dto.ts`](../src/contexts/reservations/dto/submit-feedback.dto.ts)                                        | DTO `SubmitFeedbackDto`                                                                                        |
| [`booking/src/contexts/reservations/dto/traveler-cancel-preview.dto.ts`](../src/contexts/reservations/dto/traveler-cancel-preview.dto.ts) `[PV]`                 | DTO `TravelerCancelPreviewDto` — Body of 'POST /v1/traveler/:user_id/reservations/:id/cancel-preview'.         |
| [`booking/src/contexts/reservations/dto/traveler-cancel-reservation.dto.ts`](../src/contexts/reservations/dto/traveler-cancel-reservation.dto.ts) `[PV]`         | DTO `CancellationNotesRequiredConstraint` — 'other' / 'force_majeure' need a description of at least 10 chars. |
| [`booking/src/contexts/reservations/dto/traveler-panel.dto.ts`](../src/contexts/reservations/dto/traveler-panel.dto.ts) `[PV]`                                   | DTO `TravelerReservationCardDto` — Traveler panel read DTOs (F-PV1). Stable contract for the PHP proxy:        |
| [`booking/src/contexts/reservations/dto/traveler-reservation-list-query.dto.ts`](../src/contexts/reservations/dto/traveler-reservation-list-query.dto.ts) `[PV]` | DTO `TravelerReservationListQueryDto`                                                                          |
| [`booking/src/contexts/reservations/dto/update-reservation.dto.ts`](../src/contexts/reservations/dto/update-reservation.dto.ts)                                  | DTO `UpdateReservationDto`                                                                                     |

### entities

| Archivo                                                                                                                                                                          | Propósito                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [`booking/src/contexts/reservations/entities/reservation-alternative.entity.ts`](../src/contexts/reservations/entities/reservation-alternative.entity.ts) `[PV]`                 | Entidad TypeORM `ReservationAlternativeEntity` — F-PV7b (PDF §10): the host cannot provide the stay; V4P presents an           |
| [`booking/src/contexts/reservations/entities/reservation-change-proposal.entity.ts`](../src/contexts/reservations/entities/reservation-change-proposal.entity.ts) `[PV]`         | Entidad TypeORM `ReservationChangeProposalEntity` — F-PV7b: V4P proposal answering a change request (D9: internal route only). |
| [`booking/src/contexts/reservations/entities/reservation-change-request.entity.ts`](../src/contexts/reservations/entities/reservation-change-request.entity.ts) `[PV]`           | Entidad TypeORM `ReservationChangeRequestEntity` — F-PV7b: "¿Necesitas cambiar tu reserva?". A request never modifies or       |
| [`booking/src/contexts/reservations/entities/reservation-dispute.entity.ts`](../src/contexts/reservations/entities/reservation-dispute.entity.ts) `[PV]`                         | Entidad TypeORM `ReservationDisputeEntity`                                                                                     |
| [`booking/src/contexts/reservations/entities/reservation-event.entity.ts`](../src/contexts/reservations/entities/reservation-event.entity.ts)                                    | Entidad TypeORM `ReservationEventEntity`                                                                                       |
| [`booking/src/contexts/reservations/entities/reservation-feedback-token.entity.ts`](../src/contexts/reservations/entities/reservation-feedback-token.entity.ts)                  | Entidad TypeORM `ReservationFeedbackTokenEntity`                                                                               |
| [`booking/src/contexts/reservations/entities/reservation-guest-feedback.entity.ts`](../src/contexts/reservations/entities/reservation-guest-feedback.entity.ts)                  | Entidad TypeORM `ReservationGuestFeedbackEntity`                                                                               |
| [`booking/src/contexts/reservations/entities/reservation-incident-attachment.entity.ts`](../src/contexts/reservations/entities/reservation-incident-attachment.entity.ts) `[PV]` | Entidad TypeORM `ReservationIncidentAttachmentEntity`                                                                          |
| [`booking/src/contexts/reservations/entities/reservation-incident-message.entity.ts`](../src/contexts/reservations/entities/reservation-incident-message.entity.ts) `[PV]`       | Entidad TypeORM `ReservationIncidentMessageEntity` — F-PV7a: thread "Necesitamos información" (admin) <-> answer (traveler).   |
| [`booking/src/contexts/reservations/entities/reservation-incident.entity.ts`](../src/contexts/reservations/entities/reservation-incident.entity.ts) `[PV]`                       | Entidad TypeORM `ReservationIncidentEntity` — F-PV7a (D4): traveler incident ("Tengo un problema"). UI life cycle only;        |
| [`booking/src/contexts/reservations/entities/reservation.entity.ts`](../src/contexts/reservations/entities/reservation.entity.ts) `[PV]`                                         | Entidad TypeORM `ReservationEntity`                                                                                            |

### services

| Archivo                                                                                                                                                                         | Propósito                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [`booking/src/contexts/reservations/services/reservation-alternative.service.ts`](../src/contexts/reservations/services/reservation-alternative.service.ts) `[PV]`              | Servicio `ReservationAlternativeService` — F-PV7b (PDF §10): the host cannot provide the stay and V4P presents an            |
| [`booking/src/contexts/reservations/services/reservation-change-apply.service.ts`](../src/contexts/reservations/services/reservation-change-apply.service.ts) `[PV]`            | Servicio `ReservationChangeApplyService` — F-PV7b engine shared by change proposals and alternatives:                        |
| [`booking/src/contexts/reservations/services/reservation-change-query.service.ts`](../src/contexts/reservations/services/reservation-change-query.service.ts) `[PV]`            | Servicio `ReservationChangeQueryService` — F-PV7b read side (no writes, no transactions): traveler DTOs of change            |
| [`booking/src/contexts/reservations/services/reservation-change.service.ts`](../src/contexts/reservations/services/reservation-change.service.ts) `[PV]`                        | Servicio `ReservationChangeService` — F-PV7b: change requests ("¿Necesitas cambiar tu reserva?") and V4P change              |
| [`booking/src/contexts/reservations/services/reservation-email-template.service.ts`](../src/contexts/reservations/services/reservation-email-template.service.ts) `[PV]`        | Servicio `ReservationEmailTemplateService`                                                                                   |
| [`booking/src/contexts/reservations/services/reservation-email.service.ts`](../src/contexts/reservations/services/reservation-email.service.ts) `[PV]`                          | Servicio `ReservationEmailService`                                                                                           |
| [`booking/src/contexts/reservations/services/reservation-event.service.ts`](../src/contexts/reservations/services/reservation-event.service.ts)                                 | Servicio `ReservationEventService`                                                                                           |
| [`booking/src/contexts/reservations/services/reservation-feedback.service.ts`](../src/contexts/reservations/services/reservation-feedback.service.ts) `[PV]`                    | Servicio `ReservationFeedbackService`                                                                                        |
| [`booking/src/contexts/reservations/services/reservation-incident-admin.service.ts`](../src/contexts/reservations/services/reservation-incident-admin.service.ts)               | Servicio `ReservationIncidentAdminService` — Backoffice fase 1: read side of the admino incidents inbox (internal routes     |
| [`booking/src/contexts/reservations/services/reservation-incident-notification.service.ts`](../src/contexts/reservations/services/reservation-incident-notification.service.ts) | Servicio `ReservationIncidentNotificationService` — Incident chat emails (2026-10-25): every message (traveler or V4P) sends |
| [`booking/src/contexts/reservations/services/reservation-incident.service.ts`](../src/contexts/reservations/services/reservation-incident.service.ts) `[PV]`                    | Servicio `ReservationIncidentService` — Traveler incidents (F-PV7a, D4/D5/D7). Every write runs in a transaction             |
| [`booking/src/contexts/reservations/services/reservation-lifecycle.service.ts`](../src/contexts/reservations/services/reservation-lifecycle.service.ts) `[PV]`                  | Servicio `ReservationLifecycleService` — Host actions (internal routes behind InternalApiKeyGuard, reached via the           |
| [`booking/src/contexts/reservations/services/reservation-payout.service.ts`](../src/contexts/reservations/services/reservation-payout.service.ts)                               | Servicio `ReservationPayoutService`                                                                                          |
| [`booking/src/contexts/reservations/services/reservation-quote-context.service.ts`](../src/contexts/reservations/services/reservation-quote-context.service.ts)                 | Servicio `ReservationQuoteContextService` — Read-only loader of the wizard data a quote/checkout needs: dog sizes,           |
| [`booking/src/contexts/reservations/services/reservation-refund.service.ts`](../src/contexts/reservations/services/reservation-refund.service.ts) `[PV]`                        | Servicio `ReservationRefundService`                                                                                          |
| [`booking/src/contexts/reservations/services/reservation.service.ts`](../src/contexts/reservations/services/reservation.service.ts) `[PV]`                                      | Servicio `ReservationService`                                                                                                |
| [`booking/src/contexts/reservations/services/traveler-incident-inbox.service.ts`](../src/contexts/reservations/services/traveler-incident-inbox.service.ts)                     | Servicio `TravelerIncidentInboxService` — "Incidencias" tab of the traveler account (2026-10-25). Read side only:            |
| [`booking/src/contexts/reservations/services/traveler-reservation-panel.service.ts`](../src/contexts/reservations/services/traveler-reservation-panel.service.ts) `[PV]`        | Servicio `TravelerReservationPanelService` — Read-only traveler panel (F-PV1). Ownership is 'reservations.user_id';          |
| [`booking/src/contexts/reservations/services/traveler-reservation-pay.service.ts`](../src/contexts/reservations/services/traveler-reservation-pay.service.ts)                   | Servicio `TravelerReservationPayService` — "Pagar reserva" (pay-pending). Sends the traveler back to Stripe for an           |

### types

| Archivo                                                                                                                                      | Propósito                    |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| [`booking/src/contexts/reservations/types/reservation-email.types.ts`](../src/contexts/reservations/types/reservation-email.types.ts) `[PV]` | Tipos `ReservationEmailType` |

### utils

| Archivo                                                                                                                                            | Propósito                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`booking/src/contexts/reservations/utils/change-refund.util.ts`](../src/contexts/reservations/utils/change-refund.util.ts) `[PV]`                 | Utilidad `CHANGE_REFUND_REASON_PREFIX` — F-PV7b: 'refunds.reason' (varchar 128, no migration) of the refund that     |
| [`booking/src/contexts/reservations/utils/incident-admin.util.ts`](../src/contexts/reservations/utils/incident-admin.util.ts) `[BO]`               | Utilidad `InvalidAdminActorError`                                                                                    |
| [`booking/src/contexts/reservations/utils/refund-policy.util.ts`](../src/contexts/reservations/utils/refund-policy.util.ts) `[PV]`                 | Utilidad `TRAVELER_CANCELLATION_REASON` — Traveler cancellation reasons (PDF catalogue, 13 codes) + 'voluntary', the |
| [`booking/src/contexts/reservations/utils/reservation-amount.util.ts`](../src/contexts/reservations/utils/reservation-amount.util.ts)              | Utilidad `expectedChargeCents` — Amount a reservation must be paid with (Stripe Checkout + webhook check).           |
| [`booking/src/contexts/reservations/utils/reservation-change.util.ts`](../src/contexts/reservations/utils/reservation-change.util.ts) `[PV]`       | Utilidad `CHANGE_REQUEST_TYPE` — PDF §8: "¿Necesitas cambiar tu reserva?" types.                                     |
| [`booking/src/contexts/reservations/utils/reservation-incident.util.ts`](../src/contexts/reservations/utils/reservation-incident.util.ts) `[PV]`   | Utilidad `INCIDENT_TYPE` — Traveler incidents (F-PV7a, D4). Pure catalog + rules shared by the                       |
| [`booking/src/contexts/reservations/utils/reservation-policy.util.ts`](../src/contexts/reservations/utils/reservation-policy.util.ts)              | Utilidad `REFUND_WINDOW_MS`                                                                                          |
| [`booking/src/contexts/reservations/utils/reservation-quote.util.ts`](../src/contexts/reservations/utils/reservation-quote.util.ts)                | Utilidad `SELECTION_ISSUE_CODE` — F2: pure assembly of everything a quote/checkout derives from the wizard           |
| [`booking/src/contexts/reservations/utils/saved-dog-link.util.ts`](../src/contexts/reservations/utils/saved-dog-link.util.ts)                      | Utilidad `requestedSavedDogIds` — Positive-int saved_dog_id requested per declared dog (index-aligned).              |
| [`booking/src/contexts/reservations/utils/traveler-alerts.util.ts`](../src/contexts/reservations/utils/traveler-alerts.util.ts) `[PV]`             | Utilidad `TRAVELER_ALERT` — Traveler home alerts (F-PV6, handoff §7). Pure: no I/O and no clock, 'now'               |
| [`booking/src/contexts/reservations/utils/traveler-detail.util.ts`](../src/contexts/reservations/utils/traveler-detail.util.ts) `[PV]`             | Utilidad `SiteAddressParts` — Legacy jsites1 address parts. jsites1 has no street / postcode columns                 |
| [`booking/src/contexts/reservations/utils/traveler-panel-status.util.ts`](../src/contexts/reservations/utils/traveler-panel-status.util.ts) `[PV]` | Utilidad `TRAVELER_STATUS` — Traveler-facing status (handoff §4.3). Raw enums never reach the UI.                    |
| [`booking/src/contexts/reservations/utils/traveler-token.util.ts`](../src/contexts/reservations/utils/traveler-token.util.ts)                      | Utilidad `TRAVELER_TOKEN_VERSION` — F2 security fix (F0 open risk): the public checkout must not trust a             |

## Booking API · payments

### (raíz del contexto)

| Archivo                                                                                           | Propósito                    |
| ------------------------------------------------------------------------------------------------- | ---------------------------- |
| [`booking/src/contexts/payments/payments.module.ts`](../src/contexts/payments/payments.module.ts) | Módulo Nest `PaymentsModule` |

### domain

| Archivo                                                                                                                          | Propósito                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`booking/src/contexts/payments/domain/audit-actor.ts`](../src/contexts/payments/domain/audit-actor.ts)                          | `ACTOR_TYPE` — Who performed an economic action (B1/B14).                                        |
| [`booking/src/contexts/payments/domain/cancellation-policy.ts`](../src/contexts/payments/domain/cancellation-policy.ts) `[PV]`   | `CANCELLATION_POLICY_TYPE` — Políticas de cancelación estructuradas (no texto libre).            |
| [`booking/src/contexts/payments/domain/commission.ts`](../src/contexts/payments/domain/commission.ts)                            | `FrozenCommission`                                                                               |
| [`booking/src/contexts/payments/domain/legacy-backfill.ts`](../src/contexts/payments/domain/legacy-backfill.ts)                  | `LegacyReservationRow` — Legacy reservation columns the backfill reads (raw DB row shape).       |
| [`booking/src/contexts/payments/domain/payment-state-machine.ts`](../src/contexts/payments/domain/payment-state-machine.ts)      | `PAYMENT_STATUS` — B3 · Estados de pago.                                                         |
| [`booking/src/contexts/payments/domain/payout-state-machine.ts`](../src/contexts/payments/domain/payout-state-machine.ts) `[PV]` | `PAYOUT_STATUS` — Legacy reservations.payout_status (read by PHP), the subset of B5 used         |
| [`booking/src/contexts/payments/domain/platform-settings.ts`](../src/contexts/payments/domain/platform-settings.ts)              | `PLATFORM_SETTING_KEY`                                                                           |
| [`booking/src/contexts/payments/domain/price-lines.ts`](../src/contexts/payments/domain/price-lines.ts)                          | `PriceLineDraft`                                                                                 |
| [`booking/src/contexts/payments/domain/refund-state-machine.ts`](../src/contexts/payments/domain/refund-state-machine.ts)        | `REFUND_STATUS` — B4 · Estados de reembolso.                                                     |
| [`booking/src/contexts/payments/domain/reservation-pricing.ts`](../src/contexts/payments/domain/reservation-pricing.ts)          | `DOG_SUPPLEMENT_MODE` — Dog supplement modes (unit_pet_policies.supplement_mode).                |
| [`booking/src/contexts/payments/domain/reservation-snapshot.ts`](../src/contexts/payments/domain/reservation-snapshot.ts) `[PV]` | `SNAPSHOT_SCHEMA_VERSION`                                                                        |
| [`booking/src/contexts/payments/domain/state-machine.ts`](../src/contexts/payments/domain/state-machine.ts)                      | `InvalidTransitionError` — Tiny pure state-machine helper (F1). A machine is just a map          |
| [`booking/src/contexts/payments/domain/stripe-line-items.ts`](../src/contexts/payments/domain/stripe-line-items.ts)              | `STRIPE_LINE_ITEMS_MODE` — F2: Stripe Checkout line_items built from the reservation price lines |

### dto

| Archivo                                                                                                       | Propósito             |
| ------------------------------------------------------------------------------------------------------------- | --------------------- |
| [`booking/src/contexts/payments/dto/review-refund.dto.ts`](../src/contexts/payments/dto/review-refund.dto.ts) | DTO `ReviewRefundDto` |

### entities

| Archivo                                                                                                                                                | Propósito                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| [`booking/src/contexts/payments/entities/audit-log.entity.ts`](../src/contexts/payments/entities/audit-log.entity.ts)                                  | Entidad TypeORM `AuditLogEntity` — Append-only audit trail (B1/B14). No update/delete path exists in code.           |
| [`booking/src/contexts/payments/entities/decimal.transformer.ts`](../src/contexts/payments/entities/decimal.transformer.ts)                            | Transformer `decimalTransformer` — mysql2 returns DECIMAL as string; expose it as number (null-safe).                |
| [`booking/src/contexts/payments/entities/payment.entity.ts`](../src/contexts/payments/entities/payment.entity.ts) `[PV]`                               | Entidad TypeORM `PaymentEntity` — Charge to the traveler (B2/B3). Status only changes through                        |
| [`booking/src/contexts/payments/entities/platform-setting.entity.ts`](../src/contexts/payments/entities/platform-setting.entity.ts)                    | Entidad TypeORM `PlatformSettingEntity` — Key/value platform configuration, typed on read (PlatformSettingsService). |
| [`booking/src/contexts/payments/entities/refund.entity.ts`](../src/contexts/payments/entities/refund.entity.ts) `[PV]`                                 | Entidad TypeORM `RefundEntity` — Refund operation (B2/B4). Completion is driven by Stripe webhooks                   |
| [`booking/src/contexts/payments/entities/reservation-price-line.entity.ts`](../src/contexts/payments/entities/reservation-price-line.entity.ts) `[PV]` | Entidad TypeORM `ReservationPriceLineEntity` — Immutable price breakdown line (A3/A4/B2). Never updated or deleted:  |
| [`booking/src/contexts/payments/entities/reservation-snapshot.entity.ts`](../src/contexts/payments/entities/reservation-snapshot.entity.ts) `[PV]`     | Entidad TypeORM `ReservationSnapshotEntity`                                                                          |

### services

| Archivo                                                                                                                                                | Propósito                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| [`booking/src/contexts/payments/services/audit-log.service.ts`](../src/contexts/payments/services/audit-log.service.ts)                                | Servicio `AuditLogService` — Append-only audit log (B1/B14). Only INSERTs: there is intentionally no                 |
| [`booking/src/contexts/payments/services/payment-ledger.service.ts`](../src/contexts/payments/services/payment-ledger.service.ts) `[PV]`               | Servicio `PaymentLedgerService` — Payments and refunds ledger (B2-B4). Every status change goes through the          |
| [`booking/src/contexts/payments/services/platform-settings.service.ts`](../src/contexts/payments/services/platform-settings.service.ts)                | Servicio `PlatformSettingsService` — Platform settings with a short in-memory cache (PLATFORM_SETTINGS_CACHE_TTL_MS, |
| [`booking/src/contexts/payments/services/price-lines.service.ts`](../src/contexts/payments/services/price-lines.service.ts)                            | Servicio `PriceLinesService` — Immutable price lines. Only INSERT: an adjustment is a new line                       |
| [`booking/src/contexts/payments/services/reservation-economics.service.ts`](../src/contexts/payments/services/reservation-economics.service.ts) `[PV]` | Servicio `ReservationEconomicsService` — Facade of the F1 economic model for the reservation/webhook flows:          |
| [`booking/src/contexts/payments/services/reservation-snapshot.service.ts`](../src/contexts/payments/services/reservation-snapshot.service.ts)          | Servicio `ReservationSnapshotService` — Append-only reservation snapshots (A10). 'createSnapshot' computes           |

### utils

| Archivo                                                                                             | Propósito                                                                                           |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`booking/src/contexts/payments/utils/money.util.ts`](../src/contexts/payments/utils/money.util.ts) | Utilidad `MoneyError` — Money helpers (F1). Every new economic table stores INTEGER CENTS; decimals |

## Booking API · stripe

### (raíz del contexto)

| Archivo                                                                                   | Propósito                  |
| ----------------------------------------------------------------------------------------- | -------------------------- |
| [`booking/src/contexts/stripe/stripe.module.ts`](../src/contexts/stripe/stripe.module.ts) | Módulo Nest `StripeModule` |

### api

| Archivo                                                                                                   | Propósito                          |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| [`booking/src/contexts/stripe/api/stripe.controller.ts`](../src/contexts/stripe/api/stripe.controller.ts) | Controller HTTP `StripeController` |

### dto

| Archivo                                                                                                                             | Propósito                        |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| [`booking/src/contexts/stripe/dto/create-express-account.dto.ts`](../src/contexts/stripe/dto/create-express-account.dto.ts)         | DTO `CreateExpressAccountDto`    |
| [`booking/src/contexts/stripe/dto/create-site-payment-intent.dto.ts`](../src/contexts/stripe/dto/create-site-payment-intent.dto.ts) | DTO `CreateSitePaymentIntentDto` |
| [`booking/src/contexts/stripe/dto/stripe-connect-status.dto.ts`](../src/contexts/stripe/dto/stripe-connect-status.dto.ts)           | DTO `StripeConnectStatusDto`     |

### services

| Archivo                                                                                                                     | Propósito                      |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [`booking/src/contexts/stripe/services/stripe.service.ts`](../src/contexts/stripe/services/stripe.service.ts)               | Servicio `StripeService`       |
| [`booking/src/contexts/stripe/services/user-profiles.service.ts`](../src/contexts/stripe/services/user-profiles.service.ts) | Servicio `UserProfilesService` |

### utils

| Archivo                                                                                                                   | Propósito                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [`booking/src/contexts/stripe/utils/stripe-idempotency.util.ts`](../src/contexts/stripe/utils/stripe-idempotency.util.ts) | Utilidad `stripeIdempotencyKeys` — Deterministic idempotency keys for every Stripe mutation (F0 payments). |

## Booking API · webhook

### (raíz del contexto)

| Archivo                                                                                       | Propósito                   |
| --------------------------------------------------------------------------------------------- | --------------------------- |
| [`booking/src/contexts/webhook/webhook.module.ts`](../src/contexts/webhook/webhook.module.ts) | Módulo Nest `WebhookModule` |

### api

| Archivo                                                                                                       | Propósito                           |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| [`booking/src/contexts/webhook/api/webhook.controller.ts`](../src/contexts/webhook/api/webhook.controller.ts) | Controller HTTP `WebhookController` |

### entities

| Archivo                                                                                                                                   | Propósito                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [`booking/src/contexts/webhook/entities/stripe-webhook-event.entity.ts`](../src/contexts/webhook/entities/stripe-webhook-event.entity.ts) | Entidad TypeORM `StripeWebhookEventEntity` |

### services

| Archivo                                                                                                                                   | Propósito                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [`booking/src/contexts/webhook/services/express-accounts.service.ts`](../src/contexts/webhook/services/express-accounts.service.ts)       | Servicio `ExpressAccountsService`                                                                            |
| [`booking/src/contexts/webhook/services/reservation-webhook.service.ts`](../src/contexts/webhook/services/reservation-webhook.service.ts) | Servicio `ReservationWebhookService` — Reservation side of the Stripe webhook. Every handler runs inside the |
| [`booking/src/contexts/webhook/services/webhook.service.ts`](../src/contexts/webhook/services/webhook.service.ts)                         | Servicio `WebhookService` — Stripe webhook lifecycle (F0):                                                   |

### types

| Archivo                                                                                                                         | Propósito                |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [`booking/src/contexts/webhook/types/stripe-webhook-event.type.ts`](../src/contexts/webhook/types/stripe-webhook-event.type.ts) | `StripeWebhookEventData` |

## Booking API · availability

### (raíz del contexto)

| Archivo                                                                                                           | Propósito                        |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| [`booking/src/contexts/availability/availability.module.ts`](../src/contexts/availability/availability.module.ts) | Módulo Nest `AvailabilityModule` |

### api

| Archivo                                                                                                                           | Propósito                                |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`booking/src/contexts/availability/api/availability.controller.ts`](../src/contexts/availability/api/availability.controller.ts) | Controller HTTP `AvailabilityController` |

### dto

| Archivo                                                                                                                           | Propósito                   |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| [`booking/src/contexts/availability/dto/create-availability.dto.ts`](../src/contexts/availability/dto/create-availability.dto.ts) | DTO `CreateAvailabilityDto` |
| [`booking/src/contexts/availability/dto/update-availability.dto.ts`](../src/contexts/availability/dto/update-availability.dto.ts) | DTO `UpdateAvailabilityDto` |

### entities

| Archivo                                                                                                                             | Propósito                            |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| [`booking/src/contexts/availability/entities/availability.entity.ts`](../src/contexts/availability/entities/availability.entity.ts) | Entidad TypeORM `AvailabilityEntity` |

### services

| Archivo                                                                                                                               | Propósito                      |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [`booking/src/contexts/availability/services/availability.service.ts`](../src/contexts/availability/services/availability.service.ts) | Servicio `AvailabilityService` |

## Booking API · blocks

### (raíz del contexto)

| Archivo                                                                                   | Propósito                  |
| ----------------------------------------------------------------------------------------- | -------------------------- |
| [`booking/src/contexts/blocks/blocks.module.ts`](../src/contexts/blocks/blocks.module.ts) | Módulo Nest `BlocksModule` |

### api

| Archivo                                                                                                   | Propósito                          |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| [`booking/src/contexts/blocks/api/blocks.controller.ts`](../src/contexts/blocks/api/blocks.controller.ts) | Controller HTTP `BlocksController` |

### dto

| Archivo                                                                                                   | Propósito             |
| --------------------------------------------------------------------------------------------------------- | --------------------- |
| [`booking/src/contexts/blocks/dto/create-blocks.dto.ts`](../src/contexts/blocks/dto/create-blocks.dto.ts) | DTO `CreateBlocksDto` |
| [`booking/src/contexts/blocks/dto/update-blocks.dto.ts`](../src/contexts/blocks/dto/update-blocks.dto.ts) | DTO `UpdateBlocksDto` |

### entities

| Archivo                                                                                                     | Propósito                      |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [`booking/src/contexts/blocks/entities/blocks.entity.ts`](../src/contexts/blocks/entities/blocks.entity.ts) | Entidad TypeORM `BlocksEntity` |

### services

| Archivo                                                                                                       | Propósito                |
| ------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [`booking/src/contexts/blocks/services/blocks.service.ts`](../src/contexts/blocks/services/blocks.service.ts) | Servicio `BlocksService` |

## Booking API · rooms

### (raíz del contexto)

| Archivo                                                                               | Propósito                 |
| ------------------------------------------------------------------------------------- | ------------------------- |
| [`booking/src/contexts/rooms/rooms.module.ts`](../src/contexts/rooms/rooms.module.ts) | Módulo Nest `RoomsModule` |

### api

| Archivo                                                                                               | Propósito                         |
| ----------------------------------------------------------------------------------------------------- | --------------------------------- |
| [`booking/src/contexts/rooms/api/rooms.controller.ts`](../src/contexts/rooms/api/rooms.controller.ts) | Controller HTTP `RoomsController` |

### dto

| Archivo                                                                                                                       | Propósito                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [`booking/src/contexts/rooms/dto/create-room-board-option.dto.ts`](../src/contexts/rooms/dto/create-room-board-option.dto.ts) | DTO `CreateRoomBoardOptionDto` |
| [`booking/src/contexts/rooms/dto/create-room-extra.dto.ts`](../src/contexts/rooms/dto/create-room-extra.dto.ts)               | DTO `CreateRoomExtraDto`       |
| [`booking/src/contexts/rooms/dto/create-room.dto.ts`](../src/contexts/rooms/dto/create-room.dto.ts)                           | DTO `CreateRoomDto`            |
| [`booking/src/contexts/rooms/dto/update-room-board-option.dto.ts`](../src/contexts/rooms/dto/update-room-board-option.dto.ts) | DTO `UpdateRoomBoardOptionDto` |
| [`booking/src/contexts/rooms/dto/update-room-extra.dto.ts`](../src/contexts/rooms/dto/update-room-extra.dto.ts)               | DTO `UpdateRoomExtraDto`       |
| [`booking/src/contexts/rooms/dto/update-room.dto.ts`](../src/contexts/rooms/dto/update-room.dto.ts)                           | DTO `UpdateRoomDto`            |

### entities

| Archivo                                                                                                                         | Propósito                               |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| [`booking/src/contexts/rooms/entities/room-board-option.entity.ts`](../src/contexts/rooms/entities/room-board-option.entity.ts) | Entidad TypeORM `RoomBoardOptionEntity` |
| [`booking/src/contexts/rooms/entities/room-extra.entity.ts`](../src/contexts/rooms/entities/room-extra.entity.ts)               | Entidad TypeORM `RoomExtraEntity`       |
| [`booking/src/contexts/rooms/entities/room.entity.ts`](../src/contexts/rooms/entities/room.entity.ts)                           | Entidad TypeORM `RoomEntity`            |

### services

| Archivo                                                                                                                             | Propósito                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| [`booking/src/contexts/rooms/services/room-board-options.service.ts`](../src/contexts/rooms/services/room-board-options.service.ts) | Servicio `RoomBoardOptionsService` |
| [`booking/src/contexts/rooms/services/room-extras.service.ts`](../src/contexts/rooms/services/room-extras.service.ts)               | Servicio `RoomExtrasService`       |
| [`booking/src/contexts/rooms/services/rooms.service.ts`](../src/contexts/rooms/services/rooms.service.ts)                           | Servicio `RoomsService`            |

## Booking API · site-wizard

### (raíz del contexto)

| Archivo                                                                                                       | Propósito                      |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [`booking/src/contexts/site-wizard/site-wizard.module.ts`](../src/contexts/site-wizard/site-wizard.module.ts) | Módulo Nest `SiteWizardModule` |

### api

| Archivo                                                                                                                       | Propósito                              |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| [`booking/src/contexts/site-wizard/api/site-wizard.controller.ts`](../src/contexts/site-wizard/api/site-wizard.controller.ts) | Controller HTTP `SiteWizardController` |

### dto

| Archivo                                                                                                                           | Propósito                   |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| [`booking/src/contexts/site-wizard/dto/update-site-property.dto.ts`](../src/contexts/site-wizard/dto/update-site-property.dto.ts) | DTO `UpdateSitePropertyDto` |

### entities

| Archivo                                                                                                                             | Propósito                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [`booking/src/contexts/site-wizard/entities/site-settings.entity.ts`](../src/contexts/site-wizard/entities/site-settings.entity.ts) | Entidad TypeORM `SiteSettingsEntity` — New-platform settings of a legacy site (v4p_jsites1), 1:1 by site_id. |

### services

| Archivo                                                                                                                                                             | Propósito                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [`booking/src/contexts/site-wizard/services/site-booking-settings-wizard.service.ts`](../src/contexts/site-wizard/services/site-booking-settings-wizard.service.ts) | Servicio `SiteBookingSettingsWizardService` — Wizard step 6 ("Reservas"): availability rule of the site. "all_year" |
| [`booking/src/contexts/site-wizard/services/site-content-wizard.service.ts`](../src/contexts/site-wizard/services/site-content-wizard.service.ts)                   | Servicio `SiteContentWizardService` — Wizard step 5 ("Contenido"): descriptions of v4p_jsites2 (l1 = es only).      |
| [`booking/src/contexts/site-wizard/services/site-dog-policy-wizard.service.ts`](../src/contexts/site-wizard/services/site-dog-policy-wizard.service.ts)             | Servicio `SiteDogPolicyWizardService` — Wizard step 3 ("Perros"): site-level max dogs (site_settings, synced to     |
| [`booking/src/contexts/site-wizard/services/site-review-wizard.service.ts`](../src/contexts/site-wizard/services/site-review-wizard.service.ts)                     | Servicio `SiteReviewWizardService` — Wizard step 7 ("Revisión"): completeness checklist, Dog Friendly Score         |
| [`booking/src/contexts/site-wizard/services/site-services-wizard.service.ts`](../src/contexts/site-wizard/services/site-services-wizard.service.ts)                 | Servicio `SiteServicesWizardService` — Wizard step 4 ("Servicios"), optional: dog supplies + additional services    |
| [`booking/src/contexts/site-wizard/services/site-units-wizard.service.ts`](../src/contexts/site-wizard/services/site-units-wizard.service.ts)                       | Servicio `SiteUnitsWizardService` — Wizard step 2 ("Unidades"): bookable units = 'rooms' rows of the site.          |
| [`booking/src/contexts/site-wizard/services/site-wizard.service.ts`](../src/contexts/site-wizard/services/site-wizard.service.ts)                                   | Servicio `SiteWizardService`                                                                                        |

### types

| Archivo                                                                                                                 | Propósito                  |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| [`booking/src/contexts/site-wizard/types/site-wizard.types.ts`](../src/contexts/site-wizard/types/site-wizard.types.ts) | Tipos `SiteWizardProperty` |

### utils

| Archivo                                                                                                                               | Propósito                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`booking/src/contexts/site-wizard/utils/dog-friendly-score.utils.ts`](../src/contexts/site-wizard/utils/dog-friendly-score.utils.ts) | Utilidades `SCORE_MAX` — Dog Friendly Score ("SCORE MASCOTAS" functional spec). Pure: the caller              |
| [`booking/src/contexts/site-wizard/utils/dog-policy.utils.ts`](../src/contexts/site-wizard/utils/dog-policy.utils.ts)                 | Utilidades `DOG_POLICY_LIMITS` — Pure parsing/validation + derived-field helpers of wizard step 3 ("Perros"). |
| [`booking/src/contexts/site-wizard/utils/site-booking.utils.ts`](../src/contexts/site-wizard/utils/site-booking.utils.ts)             | Utilidades `AVAILABILITY_MODE` — Pure helpers of wizard step 6 ("Reservas"). Availability model (see          |
| [`booking/src/contexts/site-wizard/utils/site-content.utils.ts`](../src/contexts/site-wizard/utils/site-content.utils.ts)             | Utilidades `CONTENT_LIMITS` — Pure helpers of wizard step 5 ("Contenido"): descriptions of v4p_jsites2        |
| [`booking/src/contexts/site-wizard/utils/site-property.utils.ts`](../src/contexts/site-wizard/utils/site-property.utils.ts)           | Utilidades `TIPO_DE_ALQUILER` — jtipo_de_alquiler ids (what the owner picks in the wizard).                   |
| [`booking/src/contexts/site-wizard/utils/site-review.utils.ts`](../src/contexts/site-wizard/utils/site-review.utils.ts)               | Utilidades `COMPLETENESS_WEIGHT` — Pure helpers of wizard step 7 ("Revisión"): completeness checklist and the |
| [`booking/src/contexts/site-wizard/utils/site-services.utils.ts`](../src/contexts/site-wizard/utils/site-services.utils.ts)           | Utilidades `SERVICE_LIMITS` — Pure parsing/validation + derived-field helpers of wizard step 4                |
| [`booking/src/contexts/site-wizard/utils/site-units.utils.ts`](../src/contexts/site-wizard/utils/site-units.utils.ts)                 | Utilidades `UNIT_LIMITS` — Pure parsing/validation + derived-field helpers of wizard step 2 ("Unidades").     |

## Booking API · traveler-dogs

### (raíz del contexto)

| Archivo                                                                                                                      | Propósito                        |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| [`booking/src/contexts/traveler-dogs/traveler-dogs.module.ts`](../src/contexts/traveler-dogs/traveler-dogs.module.ts) `[PV]` | Módulo Nest `TravelerDogsModule` |

### api

| Archivo                                                                                                                                      | Propósito                                |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`booking/src/contexts/traveler-dogs/api/traveler-dogs.controller.ts`](../src/contexts/traveler-dogs/api/traveler-dogs.controller.ts) `[PV]` | Controller HTTP `TravelerDogsController` |

### domain

| Archivo                                                                                                                                        | Propósito                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`booking/src/contexts/traveler-dogs/domain/traveler-dog.constants.ts`](../src/contexts/traveler-dogs/domain/traveler-dog.constants.ts) `[PV]` | `MAX_TRAVELER_DOGS` — F-PV5: max saved dogs per traveler (plan: MAX_TRAVELER_DOGS). |

### dto

| Archivo                                                                                                                      | Propósito                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [`booking/src/contexts/traveler-dogs/dto/traveler-dog.dto.ts`](../src/contexts/traveler-dogs/dto/traveler-dog.dto.ts) `[PV]` | DTO `CreateTravelerDogDto` — F-PV5: saved dog. Same weight range as the checkout dog (ReservationDogDto). |

### entities

| Archivo                                                                                                                                      | Propósito                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`booking/src/contexts/traveler-dogs/entities/traveler-dog.entity.ts`](../src/contexts/traveler-dogs/entities/traveler-dog.entity.ts) `[PV]` | Entidad TypeORM `TravelerDogEntity` — F-PV5 (D1 = B): a traveler's saved dog. Library only: reservations keep |

### services

| Archivo                                                                                                                                          | Propósito                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| [`booking/src/contexts/traveler-dogs/services/traveler-dogs.service.ts`](../src/contexts/traveler-dogs/services/traveler-dogs.service.ts) `[PV]` | Servicio `TravelerDogsService` — F-PV5 "Mis perros": CRUD of the traveler's dog library. Ownership is |

## Booking API · pet-policies

### (raíz del contexto)

| Archivo                                                                                                           | Propósito                       |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| [`booking/src/contexts/pet-policies/pet-policies.module.ts`](../src/contexts/pet-policies/pet-policies.module.ts) | Módulo Nest `PetPoliciesModule` |

### domain

| Archivo                                                                                                                            | Propósito                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [`booking/src/contexts/pet-policies/domain/dog-compatibility.ts`](../src/contexts/pet-policies/domain/dog-compatibility.ts) `[PV]` | `DOG_VIOLATION_CODE` — F2 payments (dog implementation B2/B3/C2): pure traveler-dog vs unit-policy |

### entities

| Archivo                                                                                                                                             | Propósito                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [`booking/src/contexts/pet-policies/entities/unit-pet-policy-zone.entity.ts`](../src/contexts/pet-policies/entities/unit-pet-policy-zone.entity.ts) | Entidad TypeORM `UnitPetPolicyZoneEntity` |
| [`booking/src/contexts/pet-policies/entities/unit-pet-policy.entity.ts`](../src/contexts/pet-policies/entities/unit-pet-policy.entity.ts)           | Entidad TypeORM `UnitPetPolicyEntity`     |

## Booking API · mail

### (raíz del contexto)

| Archivo                                                                                         | Propósito                        |
| ----------------------------------------------------------------------------------------------- | -------------------------------- |
| [`booking/src/contexts/mail/mail-queue.service.ts`](../src/contexts/mail/mail-queue.service.ts) | Servicio `MailQueueService`      |
| [`booking/src/contexts/mail/mail.constants.ts`](../src/contexts/mail/mail.constants.ts)         | `MAIL_JOB_SEND`                  |
| [`booking/src/contexts/mail/mail.controller.ts`](../src/contexts/mail/mail.controller.ts)       | Controller HTTP `MailController` |
| [`booking/src/contexts/mail/mail.module.ts`](../src/contexts/mail/mail.module.ts)               | Módulo Nest `MailModule`         |
| [`booking/src/contexts/mail/mail.processor.ts`](../src/contexts/mail/mail.processor.ts)         | `MailProcessor`                  |

### dto

| Archivo                                                                                                 | Propósito             |
| ------------------------------------------------------------------------------------------------------- | --------------------- |
| [`booking/src/contexts/mail/dto/send-test-mail.dto.ts`](../src/contexts/mail/dto/send-test-mail.dto.ts) | DTO `SendTestMailDto` |

## Booking API · shared

### (raíz del contexto)

| Archivo                                                                                                         | Propósito               |
| --------------------------------------------------------------------------------------------------------------- | ----------------------- |
| [`booking/src/contexts/shared/text-to-number.formatter.ts`](../src/contexts/shared/text-to-number.formatter.ts) | `textToNumberFormatter` |

### configs

| Archivo                                                                                 | Propósito |
| --------------------------------------------------------------------------------------- | --------- |
| [`booking/src/contexts/shared/configs/envs.ts`](../src/contexts/shared/configs/envs.ts) | `envs`    |

### dto

| Archivo                                                                                                         | Propósito                                                                               |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`booking/src/contexts/shared/dto/date-range-query.dto.ts`](../src/contexts/shared/dto/date-range-query.dto.ts) | DTO `DateRangeQueryDto` — Query 'from' / 'to' para calendarios (YYYY-MM-DD, inclusive). |
| [`booking/src/contexts/shared/dto/lang-query.dto.ts`](../src/contexts/shared/dto/lang-query.dto.ts)             | DTO `LangQueryDto`                                                                      |

### guards

| Archivo                                                                                                                          | Propósito                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`booking/src/contexts/shared/guards/internal-api-key.guard.ts`](../src/contexts/shared/guards/internal-api-key.guard.ts) `[PV]` | Guard `InternalApiKeyGuard` — Server-to-server guard (PHP web -> booking). Apply per controller or per |

### interceptors

| Archivo                                                                                                                           | Propósito                         |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| [`booking/src/contexts/shared/interceptors/response.interceptor.ts`](../src/contexts/shared/interceptors/response.interceptor.ts) | Interceptor `ResponseInterceptor` |

### legacy-db

| Archivo                                                                                                                                   | Propósito                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [`booking/src/contexts/shared/legacy-db/legacy-db.module.ts`](../src/contexts/shared/legacy-db/legacy-db.module.ts)                       | Módulo Nest `LegacyDbModule`                                                                               |
| [`booking/src/contexts/shared/legacy-db/legacy-db.service.ts`](../src/contexts/shared/legacy-db/legacy-db.service.ts)                     | Servicio `LegacyDbService` — Raw, parametrized access to legacy PHP tables (v4p_j\*). Values always go as  |
| [`booking/src/contexts/shared/legacy-db/legacy-tables.ts`](../src/contexts/shared/legacy-db/legacy-tables.ts)                             | `LEGACY_TABLE` — Whitelist of legacy PHP tables (without DB_PREFIX, which already ends in "j":             |
| [`booking/src/contexts/shared/legacy-db/site-feature-groups.service.ts`](../src/contexts/shared/legacy-db/site-feature-groups.service.ts) | Servicio `SiteFeatureGroupsService` — Loads the step-4 feature groups (SITE_FEATURE_GROUPS) that are still |
| [`booking/src/contexts/shared/legacy-db/site-feature-groups.ts`](../src/contexts/shared/legacy-db/site-feature-groups.ts)                 | `SITE_FEATURE_BLOCK` — Generated multioption fields of v4p_jsites1 shown in wizard step 4                  |

### legacy-db/entities

| Archivo                                                                                                                                         | Propósito                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [`booking/src/contexts/shared/legacy-db/entities/legacy-tipsite.entity.ts`](../src/contexts/shared/legacy-db/entities/legacy-tipsite.entity.ts) | Entidad TypeORM `LegacyTipsiteEntity` — Read-only mapping of the legacy PHP accommodation types table (v4p_jtipsite). |

### logger

| Archivo                                                                                                 | Propósito                  |
| ------------------------------------------------------------------------------------------------------- | -------------------------- |
| [`booking/src/contexts/shared/logger/logger.module.ts`](../src/contexts/shared/logger/logger.module.ts) | Módulo Nest `LoggerModule` |

### services

| Archivo                                                                                                     | Propósito               |
| ----------------------------------------------------------------------------------------------------------- | ----------------------- |
| [`booking/src/contexts/shared/services/mail.service.ts`](../src/contexts/shared/services/mail.service.ts)   | Servicio `MailService`  |
| [`booking/src/contexts/shared/services/mysql.service.ts`](../src/contexts/shared/services/mysql.service.ts) | Servicio `MysqlService` |

### transformers

| Archivo                                                                                                                         | Propósito                 |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| [`booking/src/contexts/shared/transformers/csv-ids.transformer.ts`](../src/contexts/shared/transformers/csv-ids.transformer.ts) | Transformer `parseCsvIds` |
| [`booking/src/contexts/shared/transformers/yes-no.transformer.ts`](../src/contexts/shared/transformers/yes-no.transformer.ts)   | Transformer `YES_NO`      |

### types

| Archivo                                                                                                             | Propósito                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [`booking/src/contexts/shared/types/answer-state.ts`](../src/contexts/shared/types/answer-state.ts)                 | `answer_state_values` — "unanswered" != "no": an explicit "no" counts as completed for the profile (spec C12.5) |
| [`booking/src/contexts/shared/types/service-pricing-mode.ts`](../src/contexts/shared/types/service-pricing-mode.ts) | `service_pricing_mode_values` — How a paid dog supply / additional service is charged (wizard step 4).          |

### utils

| Archivo                                                                                                 | Propósito                                                                         |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`booking/src/contexts/shared/utils/omit-undefined.ts`](../src/contexts/shared/utils/omit-undefined.ts) | `omit_undefined`                                                                  |
| [`booking/src/contexts/shared/utils/sql-like.ts`](../src/contexts/shared/utils/sql-like.ts)             | `escapeLike` — Escapes LIKE wildcards (MariaDB default escape char is backslash). |

## Booking API · additional-services

### (raíz del contexto)

| Archivo                                                                                                                                       | Propósito                              |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| [`booking/src/contexts/additional-services/additional-services.module.ts`](../src/contexts/additional-services/additional-services.module.ts) | Módulo Nest `AdditionalServicesModule` |

### entities

| Archivo                                                                                                                                                                 | Propósito                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| [`booking/src/contexts/additional-services/entities/additional-service.entity.ts`](../src/contexts/additional-services/entities/additional-service.entity.ts)           | Entidad TypeORM `AdditionalServiceEntity`     |
| [`booking/src/contexts/additional-services/entities/site-additional-service.entity.ts`](../src/contexts/additional-services/entities/site-additional-service.entity.ts) | Entidad TypeORM `SiteAdditionalServiceEntity` |

## Booking API · catalogs

### (raíz del contexto)

| Archivo                                                                                           | Propósito                    |
| ------------------------------------------------------------------------------------------------- | ---------------------------- |
| [`booking/src/contexts/catalogs/catalogs.module.ts`](../src/contexts/catalogs/catalogs.module.ts) | Módulo Nest `CatalogsModule` |

### api

| Archivo                                                                                                           | Propósito                            |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| [`booking/src/contexts/catalogs/api/catalogs.controller.ts`](../src/contexts/catalogs/api/catalogs.controller.ts) | Controller HTTP `CatalogsController` |

### services

| Archivo                                                                                                               | Propósito                  |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| [`booking/src/contexts/catalogs/services/catalogs.service.ts`](../src/contexts/catalogs/services/catalogs.service.ts) | Servicio `CatalogsService` |

### types

| Archivo                                                                                                                       | Propósito             |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| [`booking/src/contexts/catalogs/types/site-form-catalog.types.ts`](../src/contexts/catalogs/types/site-form-catalog.types.ts) | Tipos `CatalogOption` |

### utils

| Archivo                                                                                                           | Propósito                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [`booking/src/contexts/catalogs/utils/strip-html.util.ts`](../src/contexts/catalogs/utils/strip-html.util.ts)     | Utilidad `stripHtml` — Legacy rich text -> plain text: tags removed, common entities decoded, spaces collapsed. |
| [`booking/src/contexts/catalogs/utils/tipsite-tree.util.ts`](../src/contexts/catalogs/utils/tipsite-tree.util.ts) | Utilidad `TipsiteRow`                                                                                           |

## Booking API · closest-services

### (raíz del contexto)

| Archivo                                                                                                                           | Propósito                           |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| [`booking/src/contexts/closest-services/closest-services.module.ts`](../src/contexts/closest-services/closest-services.module.ts) | Módulo Nest `ClosestServicesModule` |

### entities

| Archivo                                                                                                                                                     | Propósito                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [`booking/src/contexts/closest-services/entities/closest-service.entity.ts`](../src/contexts/closest-services/entities/closest-service.entity.ts)           | Entidad TypeORM `ClosestServiceEntity`     |
| [`booking/src/contexts/closest-services/entities/site-closest-service.entity.ts`](../src/contexts/closest-services/entities/site-closest-service.entity.ts) | Entidad TypeORM `SiteClosestServiceEntity` |

## Booking API · common-zones

### (raíz del contexto)

| Archivo                                                                                                           | Propósito                       |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| [`booking/src/contexts/common-zones/common-zones.module.ts`](../src/contexts/common-zones/common-zones.module.ts) | Módulo Nest `CommonZonesModule` |

### entities

| Archivo                                                                                                                           | Propósito                          |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| [`booking/src/contexts/common-zones/entities/common-zone.entity.ts`](../src/contexts/common-zones/entities/common-zone.entity.ts) | Entidad TypeORM `CommonZoneEntity` |

## Booking API · dog-sizes

### (raíz del contexto)

| Archivo                                                                                               | Propósito                    |
| ----------------------------------------------------------------------------------------------------- | ---------------------------- |
| [`booking/src/contexts/dog-sizes/dog-sizes.module.ts`](../src/contexts/dog-sizes/dog-sizes.module.ts) | Módulo Nest `DogSizesModule` |

### entities

| Archivo                                                                                                               | Propósito                       |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| [`booking/src/contexts/dog-sizes/entities/dog-size.entity.ts`](../src/contexts/dog-sizes/entities/dog-size.entity.ts) | Entidad TypeORM `DogSizeEntity` |

## Booking API · dog-supplies

### (raíz del contexto)

| Archivo                                                                                                           | Propósito                       |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| [`booking/src/contexts/dog-supplies/dog-supplies.module.ts`](../src/contexts/dog-supplies/dog-supplies.module.ts) | Módulo Nest `DogSuppliesModule` |

### entities

| Archivo                                                                                                                                   | Propósito                             |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [`booking/src/contexts/dog-supplies/entities/dog-supply.entity.ts`](../src/contexts/dog-supplies/entities/dog-supply.entity.ts)           | Entidad TypeORM `DogSupplyEntity`     |
| [`booking/src/contexts/dog-supplies/entities/site-dog-supply.entity.ts`](../src/contexts/dog-supplies/entities/site-dog-supply.entity.ts) | Entidad TypeORM `SiteDogSupplyEntity` |

## Booking API · faq

### (raíz del contexto)

| Archivo                                                                       | Propósito               |
| ----------------------------------------------------------------------------- | ----------------------- |
| [`booking/src/contexts/faq/faq.module.ts`](../src/contexts/faq/faq.module.ts) | Módulo Nest `FaqModule` |

### entities

| Archivo                                                                                                       | Propósito                         |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| [`booking/src/contexts/faq/entities/faq-answer.entity.ts`](../src/contexts/faq/entities/faq-answer.entity.ts) | Entidad TypeORM `FaqAnswerEntity` |
| [`booking/src/contexts/faq/entities/faq.entity.ts`](../src/contexts/faq/entities/faq.entity.ts)               | Entidad TypeORM `FaqEntity`       |

## Booking API · geography

### (raíz del contexto)

| Archivo                                                                                               | Propósito                     |
| ----------------------------------------------------------------------------------------------------- | ----------------------------- |
| [`booking/src/contexts/geography/geography.module.ts`](../src/contexts/geography/geography.module.ts) | Módulo Nest `GeographyModule` |

### api

| Archivo                                                                                                               | Propósito                             |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [`booking/src/contexts/geography/api/geography.controller.ts`](../src/contexts/geography/api/geography.controller.ts) | Controller HTTP `GeographyController` |

### dto

| Archivo                                                                                                               | Propósito               |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| [`booking/src/contexts/geography/dto/geo-search-query.dto.ts`](../src/contexts/geography/dto/geo-search-query.dto.ts) | DTO `GeoSearchQueryDto` |

### services

| Archivo                                                                                                                   | Propósito                   |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| [`booking/src/contexts/geography/services/geography.service.ts`](../src/contexts/geography/services/geography.service.ts) | Servicio `GeographyService` |

### types

| Archivo                                                                                                         | Propósito         |
| --------------------------------------------------------------------------------------------------------------- | ----------------- |
| [`booking/src/contexts/geography/types/geography.types.ts`](../src/contexts/geography/types/geography.types.ts) | Tipos `Paginated` |

## Booking API · site-unit

### (raíz del contexto)

| Archivo                                                                                               | Propósito                    |
| ----------------------------------------------------------------------------------------------------- | ---------------------------- |
| [`booking/src/contexts/site-unit/site-unit.module.ts`](../src/contexts/site-unit/site-unit.module.ts) | Módulo Nest `SiteUnitModule` |

### entities

| Archivo                                                                                                                 | Propósito                        |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| [`booking/src/contexts/site-unit/entities/site-unit.entity.ts`](../src/contexts/site-unit/entities/site-unit.entity.ts) | Entidad TypeORM `SiteUnitEntity` |

## Booking API · species

### (raíz del contexto)

| Archivo                                                                                       | Propósito                   |
| --------------------------------------------------------------------------------------------- | --------------------------- |
| [`booking/src/contexts/species/species.module.ts`](../src/contexts/species/species.module.ts) | Módulo Nest `SpeciesModule` |

### entities

| Archivo                                                                                                         | Propósito                       |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| [`booking/src/contexts/species/entities/species.entity.ts`](../src/contexts/species/entities/species.entity.ts) | Entidad TypeORM `SpeciesEntity` |

## Booking API · núcleo (main, app, database, types, rooms legacy)

### src

| Archivo                                 | Propósito                                |
| --------------------------------------- | ---------------------------------------- |
| [`booking/src/main.ts`](../src/main.ts) | Bootstrap de la app Nest (arranque HTTP) |

### src/app

| Archivo                                                            | Propósito               |
| ------------------------------------------------------------------ | ----------------------- |
| [`booking/src/app/app.module.ts`](../src/app/app.module.ts) `[PV]` | Módulo Nest `AppModule` |

### src/app/health

| Archivo                                                                         | Propósito                  |
| ------------------------------------------------------------------------------- | -------------------------- |
| [`booking/src/app/health/health.module.ts`](../src/app/health/health.module.ts) | Módulo Nest `HealthModule` |

### src/app/health/api

| Archivo                                                                                         | Propósito                          |
| ----------------------------------------------------------------------------------------------- | ---------------------------------- |
| [`booking/src/app/health/api/health.controller.ts`](../src/app/health/api/health.controller.ts) | Controller HTTP `HealthController` |

### src/database

| Archivo                                                                 | Propósito          |
| ----------------------------------------------------------------------- | ------------------ |
| [`booking/src/database/data-source.ts`](../src/database/data-source.ts) | `dataSourceConfig` |

### src/types

| Archivo                                                                         | Propósito           |
| ------------------------------------------------------------------------------- | ------------------- |
| [`booking/src/types/site.types.ts`](../src/types/site.types.ts)                 | Tipos `Site`        |
| [`booking/src/types/user-profile.types.ts`](../src/types/user-profile.types.ts) | Tipos `UserProfile` |

## Booking API · Migraciones (orden cronológico)

### booking/src/database/migrations

| Archivo                                                                                                                                                                        | Propósito                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`booking/src/database/migrations/1787545446222-first-migration.ts`](../src/database/migrations/1787545446222-first-migration.ts) `[PV]`                                       | Migración `FirstMigration1787545446222`                                                                                                                                    |
| [`booking/src/database/migrations/1790205920005-dog_sizes-slugs.ts`](../src/database/migrations/1790205920005-dog_sizes-slugs.ts)                                              | Migración `DogSizesSlugs1790205920005`                                                                                                                                     |
| [`booking/src/database/migrations/1790218045430-dog-module-entities.ts`](../src/database/migrations/1790218045430-dog-module-entities.ts)                                      | Migración `DogModuleEntities1790218045430` — Hand-cleaned: MariaDB drift ALTERs (DEFAULT 'NULL' / json<->longtext churn on existing                                        |
| [`booking/src/database/migrations/1790218426503-new-tables-relations.ts`](../src/database/migrations/1790218426503-new-tables-relations.ts)                                    | Migración `NewTablesRelations1790218426503`                                                                                                                                |
| [`booking/src/database/migrations/1790218684476-pet-policy-common-zones.ts`](../src/database/migrations/1790218684476-pet-policy-common-zones.ts)                              | Migración `PetPolicyCommonZones1790218684476` — Hand-cleaned: removed MariaDB drift ALTERs (DEFAULT 'NULL' / longtext / json DROP+ADD)                                     |
| [`booking/src/database/migrations/1790400000000-site-settings.ts`](../src/database/migrations/1790400000000-site-settings.ts)                                                  | Migración `SiteSettings1790400000000` — Hand-written. New-platform settings per legacy site (v4p_jsites1), 1:1 by site_id.                                                 |
| [`booking/src/database/migrations/1790400000001-seed-registrar-alojamiento-variables.ts`](../src/database/migrations/1790400000001-seed-registrar-alojamiento-variables.ts)    | Migración `SeedRegistrarAlojamientoVariables1790400000001` — Hand-written. UI texts of the accommodation onboarding wizard, stored the legacy PHP way:                     |
| [`booking/src/database/migrations/1790716382883-new-form-tables.ts`](../src/database/migrations/1790716382883-new-form-tables.ts) `[PV]`                                       | Migración `NewFormTables1790716382883`                                                                                                                                     |
| [`booking/src/database/migrations/1790800000000-site-units-tipsite.ts`](../src/database/migrations/1790800000000-site-units-tipsite.ts)                                        | Migración `SiteUnitsTipsite1790800000000` — Hand-written. Wizard step 2 "Unidades":                                                                                        |
| [`booking/src/database/migrations/1790800000001-seed-site-units-and-step2-variables.ts`](../src/database/migrations/1790800000001-seed-site-units-and-step2-variables.ts)      | Migración `SeedSiteUnitsAndStep2Variables1790800000001` — Hand-written, idempotent.                                                                                        |
| [`booking/src/database/migrations/1790800000002-restore-site-settings-tipsite-fk.ts`](../src/database/migrations/1790800000002-restore-site-settings-tipsite-fk.ts)            | Migración `RestoreSiteSettingsTipsiteFk1790800000002` — Hand-written. NewFormTables1790716382883 (generated) dropped                                                       |
| [`booking/src/database/migrations/1790900000000-dog-policy-step3.ts`](../src/database/migrations/1790900000000-dog-policy-step3.ts)                                            | Migración `DogPolicyStep31790900000000` — Hand-written. Wizard step 3 "Perros":                                                                                            |
| [`booking/src/database/migrations/1790900000001-seed-step3-variables.ts`](../src/database/migrations/1790900000001-seed-step3-variables.ts)                                    | Migración `SeedStep3Variables1790900000001` — Hand-written, idempotent. Wizard step 3 "Perros" UI texts into the existing                                                  |
| [`booking/src/database/migrations/1790900000002-service-pricing-mode.ts`](../src/database/migrations/1790900000002-service-pricing-mode.ts)                                    | Migración `ServicePricingMode1790900000002` — Hand-written. Wizard step 4 "Servicios": how a paid dog supply / additional                                                  |
| [`booking/src/database/migrations/1790900000003-seed-step4-services.ts`](../src/database/migrations/1790900000003-seed-step4-services.ts)                                      | Migración `SeedStep4Services1790900000003` — Hand-written, idempotent. Wizard step 4 "Servicios" catalogs for species                                                      |
| [`booking/src/database/migrations/1790900000004-seed-step4-variables.ts`](../src/database/migrations/1790900000004-seed-step4-variables.ts)                                    | Migración `SeedStep4Variables1790900000004` — Hand-written, idempotent. Wizard step 4 "Servicios" UI texts into the existing                                               |
| [`booking/src/database/migrations/1790900000005-site-settings-booking.ts`](../src/database/migrations/1790900000005-site-settings-booking.ts)                                  | Migración `SiteSettingsBooking1790900000005` — Hand-written. Wizard step 6 "Reservas": availability rule chosen by the                                                     |
| [`booking/src/database/migrations/1790900000006-site-settings-terms.ts`](../src/database/migrations/1790900000006-site-settings-terms.ts)                                      | Migración `SiteSettingsTerms1790900000006` — Hand-written. Wizard step 7 "Revisión": terms accepted when the owner                                                         |
| [`booking/src/database/migrations/1790900000007-seed-steps5-7-variables.ts`](../src/database/migrations/1790900000007-seed-steps5-7-variables.ts) `[PV]`                       | Migración `SeedSteps5To7Variables1790900000007` — Hand-written, idempotent. Wizard steps 5-7 UI texts (plus step 4 prefill hint) into the existing                         |
| [`booking/src/database/migrations/1791000000000-payments-f0-hardening.ts`](../src/database/migrations/1791000000000-payments-f0-hardening.ts)                                  | Migración `PaymentsF0Hardening1791000000000` — Hand-written. Payments F0 (security + critical payment bugs):                                                               |
| [`booking/src/database/migrations/1791000000100-payments-f1-economic-model.ts`](../src/database/migrations/1791000000100-payments-f1-economic-model.ts)                        | Migración `PaymentsF1EconomicModel1791000000100` — Hand-written. Payments F1 (economic model base):                                                                        |
| [`booking/src/database/migrations/1791100000000-charge-mode-immediate.ts`](../src/database/migrations/1791100000000-charge-mode-immediate.ts) `[PV]`                           | Migración `ChargeModeImmediate1791100000000` — Hand-written. charge_mode: immediate (cobro actual) o flexible (reservado,                                                  |
| [`booking/src/database/migrations/1791200000000-reservations-user-index.ts`](../src/database/migrations/1791200000000-reservations-user-index.ts) `[PV]`                       | Migración `ReservationsUserIndex1791200000000` — Hand-written. Panel del viajero (F-PV1): listado por user_id ordenado por                                                 |
| [`booking/src/database/migrations/1791200000001-seed-cuenta-viajero-variables.ts`](../src/database/migrations/1791200000001-seed-cuenta-viajero-variables.ts) `[PV]`           | Migración `SeedCuentaViajeroVariables1791200000001` — Hand-written, idempotent. Panel del viajero V1 (F-PV3): shell + Mis reservas texts in a new                          |
| [`booking/src/database/migrations/1791200000002-seed-cancelacion-viajero-variables.ts`](../src/database/migrations/1791200000002-seed-cancelacion-viajero-variables.ts) `[PV]` | Migración `SeedCancelacionViajeroVariables1791200000002` — Hand-written, idempotent. Panel del viajero V1 (F-PV4): cancellation preview + 13 PDF reasons                   |
| [`booking/src/database/migrations/1791300000000-traveler-dogs.ts`](../src/database/migrations/1791300000000-traveler-dogs.ts) `[PV]`                                           | Migración `TravelerDogs1791300000000` — Hand-written, idempotent. Panel del viajero (F-PV5, D1 = B): saved dogs of                                                         |
| [`booking/src/database/migrations/1791300000001-juser-profiles-traveler-fields.ts`](../src/database/migrations/1791300000001-juser-profiles-traveler-fields.ts) `[PV]`         | Migración `JuserProfilesTravelerFields1791300000001` — [column, definition] — all nullable: existing rows (customers + hosts) keep working.                                |
| [`booking/src/database/migrations/1791300000002-seed-perros-perfil-variables.ts`](../src/database/migrations/1791300000002-seed-perros-perfil-variables.ts) `[PV]`             | Migración `SeedPerrosPerfilVariables1791300000002` — Hand-written, idempotent. Panel del viajero V1 (F-PV5): "Mis perros" + "Mi perfil" + cambio de                        |
| [`booking/src/database/migrations/1791300000003-seed-inicio-variables.ts`](../src/database/migrations/1791300000003-seed-inicio-variables.ts) `[PV]`                           | Migración `SeedInicioVariables1791300000003` — Hand-written, idempotent. Panel del viajero V1 (F-PV6): "Inicio" (saludo, próximo viaje, perros, alertas),                  |
| [`booking/src/database/migrations/1791400000000-reservation-incidents.ts`](../src/database/migrations/1791400000000-reservation-incidents.ts) `[PV]`                           | Migración `ReservationIncidents1791400000000` — Hand-written, idempotent. Panel del viajero (F-PV7a, D4): traveler incidents                                               |
| [`booking/src/database/migrations/1791400000001-seed-incidencias-variables.ts`](../src/database/migrations/1791400000001-seed-incidencias-variables.ts) `[PV]`                 | Migración `SeedIncidenciasVariables1791400000001` — Hand-written, idempotent. Panel del viajero V1 (F-PV7a): "Tengo un problema" (incidencias, adjuntos, hilo de           |
| [`booking/src/database/migrations/1791400000002-seed-reserva-checkout-variables.ts`](../src/database/migrations/1791400000002-seed-reserva-checkout-variables.ts)              | Migración `SeedReservaCheckoutVariables1791400000002` — Hand-written, idempotent. Wizard de reserva PHP (/reservar/{id}-{alias}, sustituye a la app React                  |
| [`booking/src/database/migrations/1791400000003-seed-reserva-dogs-variables.ts`](../src/database/migrations/1791400000003-seed-reserva-dogs-variables.ts)                      | Migración `SeedReservaDogsVariables1791400000003` — Hand-written, idempotent. Wizard de reserva PHP (/reservar/{id}-{alias}), paso 2 "Tus perros": cada perro              |
| [`booking/src/database/migrations/1791400000004-platform-commission-admino.ts`](../src/database/migrations/1791400000004-platform-commission-admino.ts)                        | Migración `PlatformCommissionAdmino1791400000004` — Hand-written, idempotent. The V4P platform commission becomes an admin-editable                                        |
| [`booking/src/database/migrations/1791400000005-seed-menu-account-header-variables.ts`](../src/database/migrations/1791400000005-seed-menu-account-header-variables.ts)        | Migración `SeedMenuAccountHeaderVariables1791400000005` — Hand-written, idempotent. Panel del viajero §2.1: cabecera del área privada en el menú global                    |
| [`booking/src/database/migrations/1791400000006-seed-panel-dogs-home-variables.ts`](../src/database/migrations/1791400000006-seed-panel-dogs-home-variables.ts)                | Migración `SeedPanelDogsHomeVariables1791400000006` — Hand-written, idempotent. Panel del viajero, spec 2.2 (tarjeta de "Mis perros": "Teo · 12 kg · No PPP" + invitación  |
| [`booking/src/database/migrations/1791400000007-juser-profiles-marketing-opt-in.ts`](../src/database/migrations/1791400000007-juser-profiles-marketing-opt-in.ts) `[PV]`       | Migración `JuserProfilesMarketingOptIn1791400000007` — [column, definition]. GDPR: consent is OFF by default (0) and NULL is read                                          |
| [`booking/src/database/migrations/1791400000008-seed-panel-small-gaps-variables.ts`](../src/database/migrations/1791400000008-seed-panel-small-gaps-variables.ts) `[PV]`       | Migración `SeedPanelSmallGapsVariables1791400000008` — Hand-written, idempotent. Panel del viajero V1, "huecos pequeños" (2026-10-23):                                     |
| [`booking/src/database/migrations/1791400000009-seed-panel-pay-pending-variables.ts`](../src/database/migrations/1791400000009-seed-panel-pay-pending-variables.ts) `[PV]`     | Migración `SeedPanelPayPendingVariables1791400000009` — Hand-written, idempotent. Panel del viajero, "Pagar reserva" (pay-pending, 2026-10-23): botón para retomar el pago |
| [`booking/src/database/migrations/1791400000010-seed-panel-changes-variables.ts`](../src/database/migrations/1791400000010-seed-panel-changes-variables.ts) `[PV]`             | Migración `SeedPanelChangesVariables1791400000010` — Hand-written, idempotent. Panel del viajero F-PV7b: "¿Necesitas cambiar tu reserva?" (solicitud de cambio),           |
| [`booking/src/database/migrations/1791400000011-reservation-changes.ts`](../src/database/migrations/1791400000011-reservation-changes.ts) `[PV]`                               | Migración `ReservationChanges1791400000011` — Hand-written, idempotent. Panel del viajero (F-PV7b): change requests                                                        |
| [`booking/src/database/migrations/1791400000012-seed-incidents-tab-variables.ts`](../src/database/migrations/1791400000012-seed-incidents-tab-variables.ts)                    | Migración `SeedIncidentsTabVariables1791400000012` — Hand-written, idempotent. Pestaña "Incidencias" del panel del viajero (chat por alojamiento, 2026-10-25):             |

## Booking API · Tests

### booking/tests/e2e

| Archivo                                                           | Propósito        |
| ----------------------------------------------------------------- | ---------------- |
| [`booking/tests/e2e/health.test.ts`](../tests/e2e/health.test.ts) | Test de `health` |

### booking/tests/performance/contexts/users

| Archivo                                                                                                       | Propósito                                              |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`booking/tests/performance/contexts/users/get-users.mjs`](../tests/performance/contexts/users/get-users.mjs) | Script de carga (performance) heredado de la plantilla |

### booking/tests/unit/app/health/api

| Archivo                                                                                                                 | Propósito        |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`booking/tests/unit/app/health/api/health.controller.test.ts`](../tests/unit/app/health/api/health.controller.test.ts) | Test de `health` |

### booking/tests/unit/contexts/catalogs

| Archivo                                                                                                                       | Propósito              |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| [`booking/tests/unit/contexts/catalogs/tipsite-tree.util.test.ts`](../tests/unit/contexts/catalogs/tipsite-tree.util.test.ts) | Test de `tipsite-tree` |

### booking/tests/unit/contexts/payments

| Archivo                                                                                                                                  | Propósito                     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| [`booking/tests/unit/contexts/payments/cancellation-policy.test.ts`](../tests/unit/contexts/payments/cancellation-policy.test.ts) `[PV]` | Test de `cancellation-policy` |
| [`booking/tests/unit/contexts/payments/economic-flows.test.ts`](../tests/unit/contexts/payments/economic-flows.test.ts) `[PV]`           | Test de `economic-flows`      |
| [`booking/tests/unit/contexts/payments/f2-checkout-flows.test.ts`](../tests/unit/contexts/payments/f2-checkout-flows.test.ts)            | Test de `f2-checkout-flows`   |
| [`booking/tests/unit/contexts/payments/legacy-backfill.test.ts`](../tests/unit/contexts/payments/legacy-backfill.test.ts)                | Test de `legacy-backfill`     |
| [`booking/tests/unit/contexts/payments/money.util.test.ts`](../tests/unit/contexts/payments/money.util.test.ts)                          | Test de `money`               |
| [`booking/tests/unit/contexts/payments/platform-commission.test.ts`](../tests/unit/contexts/payments/platform-commission.test.ts)        | Test de `platform-commission` |
| [`booking/tests/unit/contexts/payments/reservation-pricing.test.ts`](../tests/unit/contexts/payments/reservation-pricing.test.ts)        | Test de `reservation-pricing` |
| [`booking/tests/unit/contexts/payments/state-machines.test.ts`](../tests/unit/contexts/payments/state-machines.test.ts)                  | Test de `state-machines`      |

### booking/tests/unit/contexts/pet-policies

| Archivo                                                                                                                               | Propósito                   |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| [`booking/tests/unit/contexts/pet-policies/dog-compatibility.test.ts`](../tests/unit/contexts/pet-policies/dog-compatibility.test.ts) | Test de `dog-compatibility` |

### booking/tests/unit/contexts/reservations

| Archivo                                                                                                                                                                        | Propósito                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| [`booking/tests/unit/contexts/reservations/change-refund.util.test.ts`](../tests/unit/contexts/reservations/change-refund.util.test.ts) `[PV]`                                 | Test de `change-refund`                     |
| [`booking/tests/unit/contexts/reservations/incident-admin.test.ts`](../tests/unit/contexts/reservations/incident-admin.test.ts)                                                | Test de `incident-admin`                    |
| [`booking/tests/unit/contexts/reservations/incident-chat.test.ts`](../tests/unit/contexts/reservations/incident-chat.test.ts)                                                  | Test de `incident-chat`                     |
| [`booking/tests/unit/contexts/reservations/refund-policy.util.test.ts`](../tests/unit/contexts/reservations/refund-policy.util.test.ts) `[PV]`                                 | Test de `refund-policy`                     |
| [`booking/tests/unit/contexts/reservations/reservation-change.service.test.ts`](../tests/unit/contexts/reservations/reservation-change.service.test.ts) `[PV]`                 | Test de `reservation-change`                |
| [`booking/tests/unit/contexts/reservations/reservation-change.util.test.ts`](../tests/unit/contexts/reservations/reservation-change.util.test.ts) `[PV]`                       | Test de `reservation-change`                |
| [`booking/tests/unit/contexts/reservations/reservation-dates-and-expiry.test.ts`](../tests/unit/contexts/reservations/reservation-dates-and-expiry.test.ts)                    | Test de `reservation-dates-and-expiry`      |
| [`booking/tests/unit/contexts/reservations/reservation-feedback-token.service.test.ts`](../tests/unit/contexts/reservations/reservation-feedback-token.service.test.ts) `[PV]` | Test de `reservation-feedback-token`        |
| [`booking/tests/unit/contexts/reservations/reservation-incident.service.test.ts`](../tests/unit/contexts/reservations/reservation-incident.service.test.ts) `[PV]`             | Test de `reservation-incident`              |
| [`booking/tests/unit/contexts/reservations/reservation-inventory-hold.test.ts`](../tests/unit/contexts/reservations/reservation-inventory-hold.test.ts)                        | Test de `reservation-inventory-hold`        |
| [`booking/tests/unit/contexts/reservations/reservation-lifecycle.service.test.ts`](../tests/unit/contexts/reservations/reservation-lifecycle.service.test.ts)                  | Test de `reservation-lifecycle`             |
| [`booking/tests/unit/contexts/reservations/reservation-payment-and-inventory.test.ts`](../tests/unit/contexts/reservations/reservation-payment-and-inventory.test.ts)          | Test de `reservation-payment-and-inventory` |
| [`booking/tests/unit/contexts/reservations/reservation-refund.service.test.ts`](../tests/unit/contexts/reservations/reservation-refund.service.test.ts) `[PV]`                 | Test de `reservation-refund`                |
| [`booking/tests/unit/contexts/reservations/saved-dog-link.test.ts`](../tests/unit/contexts/reservations/saved-dog-link.test.ts)                                                | Test de `saved-dog-link`                    |
| [`booking/tests/unit/contexts/reservations/traveler-alerts.util.test.ts`](../tests/unit/contexts/reservations/traveler-alerts.util.test.ts) `[PV]`                             | Test de `traveler-alerts`                   |
| [`booking/tests/unit/contexts/reservations/traveler-cancellation-quote.test.ts`](../tests/unit/contexts/reservations/traveler-cancellation-quote.test.ts) `[PV]`               | Test de `traveler-cancellation-quote`       |
| [`booking/tests/unit/contexts/reservations/traveler-detail.util.test.ts`](../tests/unit/contexts/reservations/traveler-detail.util.test.ts) `[PV]`                             | Test de `traveler-detail`                   |
| [`booking/tests/unit/contexts/reservations/traveler-panel-status.util.test.ts`](../tests/unit/contexts/reservations/traveler-panel-status.util.test.ts) `[PV]`                 | Test de `traveler-panel-status`             |
| [`booking/tests/unit/contexts/reservations/traveler-reservation-panel.service.test.ts`](../tests/unit/contexts/reservations/traveler-reservation-panel.service.test.ts) `[PV]` | Test de `traveler-reservation-panel`        |
| [`booking/tests/unit/contexts/reservations/traveler-reservation-pay.test.ts`](../tests/unit/contexts/reservations/traveler-reservation-pay.test.ts) `[PV]`                     | Test de `traveler-reservation-pay`          |

### booking/tests/unit/contexts/shared

| Archivo                                                                                                                       | Propósito                |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [`booking/tests/unit/contexts/shared/guard-coverage.test.ts`](../tests/unit/contexts/shared/guard-coverage.test.ts) `[BO+PV]` | Test de `guard-coverage` |

### booking/tests/unit/contexts/site-wizard

| Archivo                                                                                                                                           | Propósito                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| [`booking/tests/unit/contexts/site-wizard/dog-friendly-score.utils.test.ts`](../tests/unit/contexts/site-wizard/dog-friendly-score.utils.test.ts) | Test de `dog-friendly-score` |
| [`booking/tests/unit/contexts/site-wizard/dog-policy.utils.test.ts`](../tests/unit/contexts/site-wizard/dog-policy.utils.test.ts)                 | Test de `dog-policy`         |
| [`booking/tests/unit/contexts/site-wizard/site-booking.utils.test.ts`](../tests/unit/contexts/site-wizard/site-booking.utils.test.ts)             | Test de `site-booking`       |
| [`booking/tests/unit/contexts/site-wizard/site-content.utils.test.ts`](../tests/unit/contexts/site-wizard/site-content.utils.test.ts)             | Test de `site-content`       |
| [`booking/tests/unit/contexts/site-wizard/site-property.utils.test.ts`](../tests/unit/contexts/site-wizard/site-property.utils.test.ts)           | Test de `site-property`      |
| [`booking/tests/unit/contexts/site-wizard/site-review.utils.test.ts`](../tests/unit/contexts/site-wizard/site-review.utils.test.ts)               | Test de `site-review`        |
| [`booking/tests/unit/contexts/site-wizard/site-services.utils.test.ts`](../tests/unit/contexts/site-wizard/site-services.utils.test.ts)           | Test de `site-services`      |
| [`booking/tests/unit/contexts/site-wizard/site-units.utils.test.ts`](../tests/unit/contexts/site-wizard/site-units.utils.test.ts)                 | Test de `site-units`         |

### booking/tests/unit/contexts/stripe

| Archivo                                                                                                                     | Propósito                    |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| [`booking/tests/unit/contexts/stripe/stripe-idempotency.test.ts`](../tests/unit/contexts/stripe/stripe-idempotency.test.ts) | Test de `stripe-idempotency` |

### booking/tests/unit/contexts/traveler-dogs

| Archivo                                                                                                                                                | Propósito               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| [`booking/tests/unit/contexts/traveler-dogs/traveler-dogs.service.test.ts`](../tests/unit/contexts/traveler-dogs/traveler-dogs.service.test.ts) `[PV]` | Test de `traveler-dogs` |

### booking/tests/unit/contexts/webhook

| Archivo                                                                                                                                           | Propósito                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| [`booking/tests/unit/contexts/webhook/reservation-webhook.disputes.test.ts`](../tests/unit/contexts/webhook/reservation-webhook.disputes.test.ts) | Test de `reservation-webhook` |
| [`booking/tests/unit/contexts/webhook/webhook.service.test.ts`](../tests/unit/contexts/webhook/webhook.service.test.ts)                           | Test de `webhook`             |

### booking/tests/utils

| Archivo                                                                                  | Propósito                                                                                     |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`booking/tests/utils/economics.ts`](../tests/utils/economics.ts)                        | `createEconomics` — Real F1 services wired over the in-memory store.                          |
| [`booking/tests/utils/fake-entity-store.ts`](../tests/utils/fake-entity-store.ts) `[PV]` | `FakeEntityStore` — Generic in-memory repository store for the F1 payments entities. Supports |
| [`booking/tests/utils/fake-reservation-db.ts`](../tests/utils/fake-reservation-db.ts)    | `FakeReservationDb`                                                                           |
| [`booking/tests/utils/mock.ts`](../tests/utils/mock.ts)                                  | Helper de mocks para tests                                                                    |
| [`booking/tests/utils/quote.ts`](../tests/utils/quote.ts)                                | `DOG_SIZES` — Seeds of migration 1790218045430 (species "Perro").                             |

## Booking API · Docs

### booking/docs

| Archivo                                                       | Propósito                                        |
| ------------------------------------------------------------- | ------------------------------------------------ |
| [`booking/docs/CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)       | Contributor Covenant Code of Conduct             |
| [`booking/docs/CONTRIBUTING.md`](CONTRIBUTING.md)             | Guía de contribución (plantilla)                 |
| [`booking/docs/SECURITY.md`](SECURITY.md)                     | Security Policy                                  |
| [`booking/docs/booking-wizard-php.md`](booking-wizard-php.md) | Wizard de reserva PHP ('/reservar/{id}-{alias}') |

### booking/docs/backoffice

| Archivo                                                                                                 | Propósito                                                       |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [`booking/docs/backoffice/BACKOFFICE-fase1-incidencias.md`](backoffice/BACKOFFICE-fase1-incidencias.md) | Backoffice fase 1 — Incidencias (admino "OPERACIONES RESERVAS") |

### booking/docs/informes

| Archivo                                                                                               | Propósito               |
| ----------------------------------------------------------------------------------------------------- | ----------------------- |
| [`booking/docs/informes/informe-avance-v1-2026-10-23.pdf`](informes/informe-avance-v1-2026-10-23.pdf) | Documento binario (PDF) |

### booking/docs/panel-viajero

| Archivo                                                                                                               | Propósito                                                |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`booking/docs/panel-viajero/HANDOFF-panel-viajero-v1.md`](panel-viajero/HANDOFF-panel-viajero-v1.md)                 | Panel del viajero V1 — instrucciones para implementación |
| [`booking/docs/panel-viajero/PLAN-desarrollo-panel-viajero-v1.md`](panel-viajero/PLAN-desarrollo-panel-viajero-v1.md) | Panel del viajero V1 — plan de desarrollo por fases      |

### booking/docs/payments

| Archivo                                                                                             | Propósito                                      |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [`booking/docs/payments/F0-seguridad-y-bugs-criticos.md`](payments/F0-seguridad-y-bugs-criticos.md) | F0 — Seguridad y bugs críticos de pagos        |
| [`booking/docs/payments/F1-modelo-economico.md`](payments/F1-modelo-economico.md)                   | F1 — Modelo económico base                     |
| [`booking/docs/payments/F2-precio-completo.md`](payments/F2-precio-completo.md)                     | F2 — Precio completo en presupuesto y checkout |
| [`booking/docs/payments/HANDOFF-siguiente-agente.md`](payments/HANDOFF-siguiente-agente.md)         | Handoff para el siguiente agente               |

## Booking API · Configuración raíz (solo nombres)

`.env` y `.env.test` existen pero NO se leen ni se listan sus valores. `pnpm-lock.yaml` incluido por completitud.

### booking/

| Archivo                                                                                                               | Propósito                                                            |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`booking/.dockerignore`](../.dockerignore)                                                                           | Exclusiones del contexto Docker                                      |
| [`booking/.editorconfig`](../.editorconfig)                                                                           | Estilo de editor                                                     |
| [`booking/.env.example`](../.env.example)                                                                             | Plantilla de variables de entorno (solo nombre; valores no listados) |
| [`booking/.eslintignore`](../.eslintignore)                                                                           | Exclusiones ESLint                                                   |
| [`booking/.eslintrc`](../.eslintrc)                                                                                   | Config ESLint                                                        |
| [`booking/.gitignore`](../.gitignore)                                                                                 | Exclusiones git                                                      |
| [`booking/.npmignore`](../.npmignore)                                                                                 | Exclusiones npm                                                      |
| [`booking/.npmrc`](../.npmrc)                                                                                         | Config npm/pnpm                                                      |
| [`booking/.nvmrc`](../.nvmrc)                                                                                         | Versión de Node                                                      |
| [`booking/.nycrc.json`](../.nycrc.json)                                                                               | Config cobertura (nyc)                                               |
| [`booking/.prettierignore`](../.prettierignore)                                                                       | Exclusiones Prettier                                                 |
| [`booking/.swcrc`](../.swcrc)                                                                                         | Config compilador SWC                                                |
| [`booking/.yamllint.yml`](../.yamllint.yml)                                                                           | Config yamllint                                                      |
| [`booking/Dockerfile`](../Dockerfile)                                                                                 | Imagen Docker de la API booking                                      |
| [`booking/Flujo_registro_Booking_referencia_Viajes4Patas.pdf`](../Flujo_registro_Booking_referencia_Viajes4Patas.pdf) | Documento binario (PDF)                                              |
| [`booking/IMPLEMENTACION PERROS (1).pdf`](<../IMPLEMENTACION%20PERROS%20(1).pdf>)                                     | Documento binario (PDF)                                              |
| [`booking/LICENSE.md`](../LICENSE.md)                                                                                 | Licencia                                                             |
| [`booking/README.md`](../README.md)                                                                                   | README del servicio booking                                          |
| [`booking/SCORE MASCOTAS (1).pdf`](<../SCORE%20MASCOTAS%20(1).pdf>)                                                   | Documento binario (PDF)                                              |
| [`booking/_typos.toml`](../_typos.toml)                                                                               | Config corrector typos                                               |
| [`booking/commitlint.config.ts`](../commitlint.config.ts)                                                             | Config commitlint                                                    |
| [`booking/create-vitest-test-config.ts`](../create-vitest-test-config.ts)                                             | Factory de config Vitest                                             |
| [`booking/dev.yml`](../dev.yml)                                                                                       | Config entorno dev                                                   |
| [`booking/docker-compose.yml`](../docker-compose.yml)                                                                 | Stack local (API + BD + Redis…)                                      |
| [`booking/lint-staged.config.mjs`](../lint-staged.config.mjs)                                                         | Hooks lint-staged                                                    |
| [`booking/nest-cli.json`](../nest-cli.json)                                                                           | Config Nest CLI                                                      |
| [`booking/package.json`](../package.json)                                                                             | Dependencias y scripts (pnpm)                                        |
| [`booking/pnpm-lock.yaml`](../pnpm-lock.yaml)                                                                         | Lockfile pnpm                                                        |
| [`booking/prettier.config.mjs`](../prettier.config.mjs)                                                               | Config Prettier                                                      |
| [`booking/skills-lock.json`](../skills-lock.json)                                                                     | Lock de skills de agentes                                            |
| [`booking/tsconfig.json`](../tsconfig.json)                                                                           | Config TypeScript                                                    |
| [`booking/tsconfig.prod.json`](../tsconfig.prod.json)                                                                 | Config TypeScript build prod                                         |
| [`booking/vitest.config.e2e.ts`](../vitest.config.e2e.ts)                                                             | Config Vitest e2e                                                    |
| [`booking/vitest.config.ts`](../vitest.config.ts)                                                                     | Config Vitest base                                                   |
| [`booking/vitest.config.unit.ts`](../vitest.config.unit.ts) `[PV]`                                                    | Config Vitest unit                                                   |
| [`booking/vitest.shared.ts`](../vitest.shared.ts)                                                                     | Config Vitest compartida                                             |

## Web · Reserva pública (/reservar, retorno Stripe, feedback, confirmación)

### Entradas xx/ (rutas)

| Archivo                                                                                   | Propósito                                                                                             |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [`web/xx/reservation-book.php`](../../web/xx/reservation-book.php)                        | Textos (jvariables página 'reserva_checkout') ya disponibles para el <title>; el body vuelve a cargar |
| [`web/xx/reservation-success.php`](../../web/xx/reservation-success.php)                  | Ruta /reserva-exito (retorno Stripe OK) → php/reservation_success_body.php                            |
| [`web/xx/reservation-cancel.php`](../../web/xx/reservation-cancel.php)                    | Ruta /reserva-cancelada (retorno Stripe cancelado) → php/reservation_cancel_body.php                  |
| [`web/xx/reservation-feedback.php`](../../web/xx/reservation-feedback.php)                | Ruta /reserva-feedback/{token} (valoración post-estancia)                                             |
| [`web/xx/reservation-confirmation.php`](../../web/xx/reservation-confirmation.php) `[PV]` | Panel del viajero §14 — Confirmación de reserva imprimible (/mi-reserva/confirmacion/{id}).           |

### Cuerpos php/

| Archivo                                                                                               | Propósito                                                                |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`web/php/reservation_book_body.php`](../../web/php/reservation_book_body.php)                        | Cuerpo de la página wizard de reserva (/reservar/{id}-{alias}).          |
| [`web/php/reservation_success_body.php`](../../web/php/reservation_success_body.php)                  | Cuerpo de la página de éxito post-pago Stripe.                           |
| [`web/php/reservation_cancel_body.php`](../../web/php/reservation_cancel_body.php)                    | Cuerpo de la página de cancelación post-Stripe Checkout.                 |
| [`web/php/reservation_feedback_body.php`](../../web/php/reservation_feedback_body.php)                | Cuerpo de la página de feedback post-estancia.                           |
| [`web/php/reservation_confirmation_body.php`](../../web/php/reservation_confirmation_body.php) `[PV]` | Panel del viajero §14 — cuerpo de la confirmación de reserva imprimible. |

### Componentes

| Archivo                                                                                                 | Propósito                                                                                               |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`web/components/reservation_book_wizard.php`](../../web/components/reservation_book_wizard.php) `[PV]` | Wizard de reserva PHP (/reservar/{id}-{alias}) — sustituye a la app React booking-frontend (deprecada). |
| [`web/components/reservation_form.php`](../../web/components/reservation_form.php)                      | Formulario lateral de reserva (página alojamiento).                                                     |
| [`web/components/reservation_card.php`](../../web/components/reservation_card.php)                      | Tarjeta compacta de reserva (CTA hacia página wizard).                                                  |
| [`web/components/new_reservation_form.php`](../../web/components/new_reservation_form.php)              | Formulario de reserva con checkout Stripe (pantalla única).                                             |

### Textos / variables

| Archivo                                                                          | Propósito                                                        |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [`web/inc/reservation_book_texts.php`](../../web/inc/reservation_book_texts.php) | Textos del wizard de reserva PHP (/reservar/{id}-{alias}).       |
| [`web/inc/reserva_checkout_vble.php`](../../web/inc/reserva_checkout_vble.php)   | Carga $vble para páginas reserva_checkout (éxito / cancelación). |

### JS

| Archivo                                                                                         | Propósito                                                                                               |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`web/js/reservation_book.js`](../../web/js/reservation_book.js)                                | Wizard de reserva PHP (/reservar/{id}-{alias}) — sustituye a la app React booking-frontend (deprecada). |
| [`web/js/booking_reservation_checkout.js`](../../web/js/booking_reservation_checkout.js) `[PV]` | JS del checkout de reserva (paso de pago / redirección a Stripe Checkout)                               |
| [`web/js/booking_reservation_success.js`](../../web/js/booking_reservation_success.js)          | F0 pagos: el resumen público exige el id de la Checkout Session que Stripe                              |
| [`web/js/booking_reservation_feedback.js`](../../web/js/booking_reservation_feedback.js)        | JS de la página de valoración post-estancia (/reserva-feedback)                                         |

### CSS

| Archivo                                                                                                           | Propósito                                                                                     |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`web/css/components/reservation_book.css`](../../web/css/components/reservation_book.css)                        | reservation_book.css — piezas del wizard de reserva PHP (/reservar/{id}-{alias}) que no cubre |
| [`web/css/components/reservation_form.css`](../../web/css/components/reservation_form.css)                        | box-shadow: 0 0 10px 0 rgba(0, 0, 0, 0.1);                                                    |
| [`web/css/components/new_reservation_form.css`](../../web/css/components/new_reservation_form.css)                | new_reservation_form.css — checkout de reserva en ficha alojamiento + páginas éxito/cancel.   |
| [`web/css/components/reservation_confirmation.css`](../../web/css/components/reservation_confirmation.css) `[PV]` | Panel del viajero §14 — Confirmación de reserva imprimible (xx/reservation-confirmation.php). |

### Ficha de alojamiento (punto de entrada al formulario de reserva)

| Archivo                                                                  | Propósito                                                                                            |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| [`web/xx/site.php`](../../web/xx/site.php)                               | Ficha pública de alojamiento; carga CSS del formulario de reserva e incluye php/pageSitesElement.php |
| [`web/php/pageSitesElement.php`](../../web/php/pageSitesElement.php)     | Cuerpo de la ficha de alojamiento; incluye components/reservation_form.php y reservation_card.php    |
| [`web/php/pageSitesElement1.php`](../../web/php/pageSitesElement1.php)   | Variante de la ficha de alojamiento con inc/booking_checkout_lib.php + formulario de reserva         |
| [`web/css/pages/site_element.css`](../../web/css/pages/site_element.css) | Estilos de la ficha de alojamiento (contenedor del formulario de reserva)                            |

## Web · Panel viajero / cuenta unificada

### Entradas y cuerpo (cuenta unificada en usprofile; socprofile redirige)

| Archivo                                                                       | Propósito                                                                                                        |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`web/xx/usprofile.php`](../../web/xx/usprofile.php) `[PV]`                   | Cuenta unificada (2026-10-22): anfitrión (host con $\_SESSION['client']) y viajero (customer) comparten          |
| [`web/php/usprofile_body.php`](../../web/php/usprofile_body.php) `[PV]`       | Cuerpo de la cuenta unificada (anfitrión + viajero): pestañas de reservas, habitaciones, Stripe Connect y tv\_\* |
| [`web/xx/socprofile.php`](../../web/xx/socprofile.php) `[PV]`                 | Cuenta unificada (2026-10-22): /socperf y /mi-cuenta ya no tienen página propia.                                 |
| [`web/php/socprofile_body.php`](../../web/php/socprofile_body.php) `[PV]`     | Cuerpo legacy del perfil viajero (la ruta ahora redirige a la cuenta unificada)                                  |
| [`web/php/socprofile_update.php`](../../web/php/socprofile_update.php) `[PV]` | Update legacy del perfil viajero                                                                                 |

### Componentes (pestañas tv\_\*)

| Archivo                                                                                                     | Propósito                                                                                                  |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [`web/components/traveler_home_tab.php`](../../web/components/traveler_home_tab.php) `[PV]`                 | Panel del viajero — pestaña Inicio (F-PV6, handoff §7; spec 2.3).                                          |
| [`web/components/traveler_reservations_tab.php`](../../web/components/traveler_reservations_tab.php) `[PV]` | Panel del viajero — pestaña Mis reservas (F-PV3): listado por pestañas + detalle (solo lectura) + valorar. |
| [`web/components/traveler_incidents_tab.php`](../../web/components/traveler_incidents_tab.php) `[PV]`       | Panel del viajero — pestaña Incidencias (2026-10-25): bandeja agrupada por alojamiento + conversación      |
| [`web/components/traveler_dogs_tab.php`](../../web/components/traveler_dogs_tab.php) `[PV]`                 | Panel del viajero — pestaña Mis perros (F-PV5).                                                            |
| [`web/components/traveler_club_tab.php`](../../web/components/traveler_club_tab.php) `[PV]`                 | Panel del viajero — pestaña Club 4Patas. Solo enlace + placeholder: sin puntos en V1 (plan §6).            |
| [`web/components/traveler_profile_tab.php`](../../web/components/traveler_profile_tab.php) `[PV]`           | Panel del viajero — pestaña Mi perfil (F-PV5).                                                             |
| [`web/components/navbar_account_menu.php`](../../web/components/navbar_account_menu.php)                    | Cabecera del área privada (Panel del viajero §2.1): avatar circular + nombre + ▾ con accesos rápidos.      |
| [`web/components/navbar_user_dropdown.php`](../../web/components/navbar_user_dropdown.php)                  | Dropdown de usuario del navbar (acceso a la cuenta/paneles)                                                |

### JS

| Archivo                                                                                 | Propósito                                                                                               |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`web/js/traveler_account.js`](../../web/js/traveler_account.js) `[PV]`                 | Panel del viajero (F-PV3, ampliado en F-PV5) — cliente común de "Mi cuenta".                            |
| [`web/js/traveler_home.js`](../../web/js/traveler_home.js) `[PV]`                       | Panel del viajero (F-PV6) — pestaña Inicio.                                                             |
| [`web/js/traveler_reservations.js`](../../web/js/traveler_reservations.js) `[PV]`       | Panel del viajero (F-PV3) — pestaña Mis reservas.                                                       |
| [`web/js/traveler_changes.js`](../../web/js/traveler_changes.js) `[PV]`                 | Panel del viajero (F-PV7b) — "¿Necesitas cambiar tu reserva?" dentro del detalle de una reserva.        |
| [`web/js/traveler_incidents.js`](../../web/js/traveler_incidents.js) `[PV]`             | Panel del viajero (F-PV7a) — "Tengo un problema" dentro del detalle de una reserva.                     |
| [`web/js/traveler_incidents_inbox.js`](../../web/js/traveler_incidents_inbox.js) `[PV]` | Panel del viajero — pestaña "Incidencias" (2026-10-25): bandeja de todas las incidencias del usuario    |
| [`web/js/traveler_dogs.js`](../../web/js/traveler_dogs.js) `[PV]`                       | Panel del viajero (F-PV5) — pestaña Mis perros.                                                         |
| [`web/js/traveler_dog_dialog.js`](../../web/js/traveler_dog_dialog.js)                  | Diálogo compartido de alta/edición de perro (nombre, peso, PPP, foto) — extraído de js/traveler_dogs.js |
| [`web/js/traveler_profile.js`](../../web/js/traveler_profile.js) `[PV]`                 | Panel del viajero (F-PV5) — pestaña Mi perfil.                                                          |

### CSS

| Archivo                                                                                           | Propósito                                                                                      |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [`web/css/components/traveler_account.css`](../../web/css/components/traveler_account.css) `[PV]` | traveler*account.css — pestañas del viajero (tv*\*) de la cuenta unificada (/mi-perfil-textos, |

### Menú / enlaces globales

| Archivo                                                           | Propósito                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------- |
| [`web/inc/global_menu.php`](../../web/inc/global_menu.php) `[PV]` | Menú global; enlaces a la cuenta (tv_reservas) y paneles |
| [`web/inc/global_links.php`](../../web/inc/global_links.php)      | Slugs/enlaces (booking, mi-perfil-textos, socperf)       |

## Web · Panel anfitrión (reservas, habitaciones, Stripe Connect, perfil)

### Componentes

| Archivo                                                                                                       | Propósito                                                             |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`web/components/usprofile_reservations_tab.php`](../../web/components/usprofile_reservations_tab.php) `[PV]` | Pestaña Reservas (tab8) — Stripe Connect + listado de reservas.       |
| [`web/components/usprofile_rooms_tab.php`](../../web/components/usprofile_rooms_tab.php)                      | Pestaña Habitaciones (tab9) — CRUD rooms + calendario por habitación. |
| [`web/components/usprofile_stripe_connect.php`](../../web/components/usprofile_stripe_connect.php)            | Pestaña Reservas (tab8) — Bloque Stripe Connect para hosts.           |

### JS

| Archivo                                                                                      | Propósito                                                                       |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`web/js/booking_reservations_dashboard.js`](../../web/js/booking_reservations_dashboard.js) | Panel calendario + booking (dispo, bloques, reservas)                           |
| [`web/js/booking_reservations_list.js`](../../web/js/booking_reservations_list.js)           | F0 pagos: las rutas de anfitrión de la booking API son internas                 |
| [`web/js/booking_rooms_dashboard.js`](../../web/js/booking_rooms_dashboard.js)               | Panel habitaciones: CRUD rooms + calendario por room (dispo, bloques, reservas) |
| [`web/js/booking_stripe_connect.js`](../../web/js/booking_stripe_connect.js)                 | Stripe Connect — tab8 perfil host                                               |
| [`web/js/jCombobox.js`](../../web/js/jCombobox.js)                                           | jCombobox — combobox accesible con búsqueda server-side y scroll infinito.      |

### CSS

| Archivo                                                                                                         | Propósito                                                                            |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [`web/css/pages/us_profile.css`](../../web/css/pages/us_profile.css)                                            | ===== New Fields Alert Banner =====                                                  |
| [`web/css/components/us_profile_reservations.css`](../../web/css/components/us_profile_reservations.css) `[PV]` | us_profile_reservations.css — pestañas tab8 (Reservas) y tab9 (Habitaciones).        |
| [`web/css/components/us_profile_rooms.css`](../../web/css/components/us_profile_rooms.css)                      | us_profile_rooms.css — pestaña tab9 (Habitaciones).                                  |
| [`web/css/components/us_profile_stripe_connect.css`](../../web/css/components/us_profile_stripe_connect.css)    | us_profile_stripe_connect.css — bloque Stripe Connect en tab8 (perfil host).         |
| [`web/css/components/us_profile_combobox.css`](../../web/css/components/us_profile_combobox.css)                | us_profile_combobox.css — combobox con búsqueda y scroll infinito (js/jCombobox.js). |

### Endpoints PHP del perfil

| Archivo                                                                                          | Propósito                                                                                                                  |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| [`web/php/usprofile_sendMail.php`](../../web/php/usprofile_sendMail.php)                         | Idioma de sesión para guardar descripciones multilenguaje (el email va en español)                                         |
| [`web/php/usprofile_chpwd.php`](../../web/php/usprofile_chpwd.php) `[PV]`                        | Validación ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++                                              |
| [`web/php/usprofile_poblaciones.php`](../../web/php/usprofile_poblaciones.php)                   | Se pide una fila extra (limit + 1) para saber si hay más páginas sin ejecutar COUNT(\*).                                   |
| [`web/php/usprofile_provincias.php`](../../web/php/usprofile_provincias.php)                     | Se pide una fila extra (limit + 1) para saber si hay más páginas sin ejecutar COUNT(\*).                                   |
| [`web/php/usprofile_room_photos_sendMail.php`](../../web/php/usprofile_room_photos_sendMail.php) | Subida de fotos de habitaciones (panel anfitrión)                                                                          |
| [`web/php/usprofile_room_photos_delete.php`](../../web/php/usprofile_room_photos_delete.php)     | Borrado de fotos de habitaciones (panel anfitrión)                                                                         |
| [`web/php/usprofilefotos_sendMail.php`](../../web/php/usprofilefotos_sendMail.php)               | Validate file upload                                                                                                       |
| [`web/php/usprofilefotos_delete.php`](../../web/php/usprofilefotos_delete.php)                   | Misma fila jsites2 (MIN(id)) y mismas rutas de disco que la pestaña Fotos y el wizard (inc/booking_wizard_photos_lib.php). |

### Legacy / prototipos

| Archivo                                                                                    | Propósito                                                                                |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [`web/php/legacy/usprofile_body.php`](../../web/php/legacy/usprofile_body.php) `[PV]`      | Copia legacy del cuerpo de usprofile (no enrutada)                                       |
| [`web/php/legacy/usprofile_sendMail.php`](../../web/php/legacy/usprofile_sendMail.php)     | Lectura de campos dinámicos text/number                                                  |
| [`web/reservaciones-config-prototype.html`](../../web/reservaciones-config-prototype.html) | Prototipo — estilos de la pestaña reservas (preview antes de integrar en us_profile.css) |

## Web · Wizard alta alojamiento (/registrar-alojamiento, fsc\_)

### Entrada y cuerpo

| Archivo                                                                | Propósito                                                                                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [`web/xx/ussitecreate.php`](../../web/xx/ussitecreate.php)             | Guard: solo anfitriones logueados (uslogin_verification.php fija client + user_id).                                               |
| [`web/php/ussitecreate_body.php`](../../web/php/ussitecreate_body.php) | Variables definidas en la cadena de includes (xx/ussitecreate.php → \_init, global_menu, global_head, global_path, global_links). |

### Endpoints

| Archivo                                                                           | Propósito                                                                                |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`web/php/ussitecreate_api.php`](../../web/php/ussitecreate_api.php)              | Proxy JSON del wizard de alta de alojamiento (registrar-alojamiento) → booking API.      |
| [`web/php/ussitecreate_photos.php`](../../web/php/ussitecreate_photos.php) `[PV]` | Fotos del wizard de alta (registrar-alojamiento). JSON. PHP es el dueño de los ficheros: |

### Pasos

| Archivo                                                                                | Propósito                                                                        |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`web/components/ussitecreate_step1.php`](../../web/components/ussitecreate_step1.php) | Paso 1 del wizard de alta (registrar-alojamiento): Tipo, Contacto, Ubicación.    |
| [`web/components/ussitecreate_step2.php`](../../web/components/ussitecreate_step2.php) | Paso 2 del wizard de alta (registrar-alojamiento): Unidades (lo que se reserva). |
| [`web/components/ussitecreate_step3.php`](../../web/components/ussitecreate_step3.php) | Paso 3 del wizard de alta (registrar-alojamiento): Política de perros.           |
| [`web/components/ussitecreate_step4.php`](../../web/components/ussitecreate_step4.php) | Paso 4 del wizard de alta (registrar-alojamiento): Servicios.                    |
| [`web/components/ussitecreate_step5.php`](../../web/components/ussitecreate_step5.php) | Paso 5 del wizard de alta (registrar-alojamiento): Fotos y descripción.          |
| [`web/components/ussitecreate_step6.php`](../../web/components/ussitecreate_step6.php) | Paso 6 del wizard de alta (registrar-alojamiento): Reservas y cobros.            |
| [`web/components/ussitecreate_step7.php`](../../web/components/ussitecreate_step7.php) | Paso 7 del wizard de alta (registrar-alojamiento): Revisión y publicación.       |

### JS / CSS

| Archivo                                                                                    | Propósito                                                                                                |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [`web/js/booking_site_wizard.js`](../../web/js/booking_site_wizard.js)                     | Alta de alojamiento (registrar-alojamiento) — wizard onboarding host.                                    |
| [`web/css/pages/us_sitecreate.css`](../../web/css/pages/us_sitecreate.css)                 | ===== Alta de alojamiento (wizard registrar-alojamiento) =====                                           |
| [`web/css/pages/us_profile_sitecreate.css`](../../web/css/pages/us_profile_sitecreate.css) | us_profile_sitecreate.css — acceso al wizard "registrar-alojamiento" desde el perfil (mi-perfil-textos). |

### SQL

| Archivo                                                                                      | Propósito                                                                                    |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`web/sql/registrar_alojamiento_textos.sql`](../../web/sql/registrar_alojamiento_textos.sql) | Textos del wizard 'registrar-alojamiento' (pagina v4p_jvariables0 = 'registraralojamiento'). |

## Web · Proxies PHP → API Nest

### php/

| Archivo                                                                             | Propósito                                                                                            |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`web/php/booking_reservation_api.php`](../../web/php/booking_reservation_api.php)  | Proxy JSON del wizard de reserva PHP (/reservar/{id}-{alias}, js/reservation_book.js) → booking API. |
| [`web/php/booking_host_api.php`](../../web/php/booking_host_api.php) `[PV]`         | Proxy JSON del panel del anfitrión (reservas, Stripe Connect, habitaciones,                          |
| [`web/php/booking_traveler_api.php`](../../web/php/booking_traveler_api.php) `[PV]` | Proxy JSON del panel del viajero → booking API con X-Internal-Key.                                   |
| [`web/php/traveler_profile_api.php`](../../web/php/traveler_profile_api.php) `[PV]` | Panel del viajero (F-PV5) — "Mi perfil" JSON. 100 % PHP: v4p_juser_profiles es de PHP (D6),          |

## Web · Emails de reservas y cola

### Endpoints / workers

| Archivo                                                                                                | Propósito                                                          |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [`web/php/booking_reservation_email.php`](../../web/php/booking_reservation_email.php)                 | Dispatcher HTTP único de emails de reserva.                        |
| [`web/php/booking_reservation_confirm_email.php`](../../web/php/booking_reservation_confirm_email.php) | Endpoint legacy de confirmación — delega al dispatcher unificado.  |
| [`web/php/email_queue_drain_reservas.php`](../../web/php/email_queue_drain_reservas.php)               | Drena la cola de correos de reserva (one-off CLI).                 |
| [`web/php/email_queue_drain_reservas_http.php`](../../web/php/email_queue_drain_reservas_http.php)     | Endpoint HTTP para drenar la cola de correos de reserva por lotes. |
| [`web/php/email_queue_worker.php`](../../web/php/email_queue_worker.php)                               | Worker de cola de correos (ejecutar por cron, p. ej. cada minuto): |

### Librerías

| Archivo                                                                                          | Propósito                                                    |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| [`web/inc/booking_reservation_email_lib.php`](../../web/inc/booking_reservation_email_lib.php)   | Librería unificada de emails de reservas booking.            |
| [`web/inc/email_queue_drain_reservas_lib.php`](../../web/inc/email_queue_drain_reservas_lib.php) | Lógica compartida para drenar la cola de correos de reserva. |
| [`web/inc/email_queue_lib.php`](../../web/inc/email_queue_lib.php)                               | Cola de envío de correos (encolado en BD + worker CLI).      |

### SQL

| Archivo                                                    | Propósito                                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`web/sql/email_queue.sql`](../../web/sql/email_queue.sql) | Cola de correos (perfil / fotos). Ejecutar en la misma base que usa la aplicación. |

## Web · Librerías inc/ y conexión

### inc/

| Archivo                                                                                       | Propósito                                                                                       |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`web/inc/booking_checkout_lib.php`](../../web/inc/booking_checkout_lib.php) `[PV]`           | Helpers compartidos: elegibilidad checkout online (Stripe Connect + habitaciones).              |
| [`web/inc/booking_wizard_lib.php`](../../web/inc/booking_wizard_lib.php) `[BO]`               | Cliente cURL para los endpoints internos del wizard de alta (booking API /v1).                  |
| [`web/inc/booking_wizard_photos_lib.php`](../../web/inc/booking_wizard_photos_lib.php) `[PV]` | Fotos del wizard de alta (registrar-alojamiento): helpers compartidos por                       |
| [`web/inc/booking_room_photos_lib.php`](../../web/inc/booking_room_photos_lib.php)            | Helpers compartidos: fotos de habitación (jrooms) + PATCH booking API.                          |
| [`web/inc/booking_react_assets.php`](../../web/inc/booking_react_assets.php)                  | DEPRECADO (2026-10-23): la app React booking-frontend ya no se usa. El wizard de reserva es PHP |
| [`web/inc/traveler_media_lib.php`](../../web/inc/traveler_media_lib.php) `[BO+PV]`            | Panel del viajero (F-PV5, decisión D5) — fotos privadas del viajero (perros y avatar).          |
| [`web/inc/global_path.php`](../../web/inc/global_path.php) `[PV]`                             | Rutas/URLs de medios públicos (usadas por fotos del wizard/habitaciones)                        |
| [`web/inc/global_connect.php`](../../web/inc/global_connect.php)                              | Conexión BD + $booking_api_base_url (copia en inc/)                                             |

### Raíz web

| Archivo                                                  | Propósito                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| [`web/global_connect.php`](../../web/global_connect.php) | Conexión BD + $booking_api_base_url (BOOKING_URL / RESERVATIONS_URL) |
| [`web/docker-compose.yml`](../../web/docker-compose.yml) | Stack Docker web; define BOOKING_URL hacia la API                    |
| [`web/.env.example`](../../web/.env.example)             | Plantilla de variables de entorno (solo nombre; valores no listados) |

### Uploads privados del viajero

| Archivo                                                                | Propósito                                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`web/private_uploads/.htaccess`](../../web/private_uploads/.htaccess) | Bloquea acceso directo a fotos privadas del viajero (servidas vía traveler_media_lib) |

## Web · Admino backoffice

### admino/php

| Archivo                                                                                | Propósito                                                                                         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`web/admino/php/admSelect.php`](../../web/admino/php/admSelect.php) `[BO]`            | Menú principal de admino (incluye OPERACIONES RESERVAS y COMISIÓN PLATAFORMA %)                   |
| [`web/admino/php/admReservas.php`](../../web/admino/php/admReservas.php) `[BO]`        | Backoffice: listado/gestión de reservas (OPERACIONES RESERVAS)                                    |
| [`web/admino/php/admIncidencias.php`](../../web/admino/php/admIncidencias.php) `[BO]`  | Backoffice fase 1 — OPERACIONES RESERVAS > INCIDENCIAS (bandeja).                                 |
| [`web/admino/php/admIncidencia.php`](../../web/admino/php/admIncidencia.php) `[BO+PV]` | Backoffice fase 1 — OPERACIONES RESERVAS > INCIDENCIAS > detalle (?id=N).                         |
| [`web/admino/php/admOps_api.php`](../../web/admino/php/admOps_api.php) `[BO]`          | Backoffice fase 1 (OPERACIONES RESERVAS) — ÚNICO proxy de admino hacia la API interna de booking. |
| [`web/admino/php/admOps_lib.php`](../../web/admino/php/admOps_lib.php) `[BO]`          | Backoffice fase 1 (OPERACIONES RESERVAS) — helpers compartidos por las páginas                    |
| [`web/admino/php/jGlobal_data.php`](../../web/admino/php/jGlobal_data.php) `[BO]`      | CRUD genérico de tablas (p. ej. jplatform_commission)                                             |
| [`web/admino/php/jGlobal_updb.php`](../../web/admino/php/jGlobal_updb.php)             | Guardado genérico de admino; validación validation_type 'percentage' (comisión 0–<100)            |
| [`web/admino/php/admLogin.php`](../../web/admino/php/admLogin.php) `[BO]`              | Login del backoffice admino                                                                       |
| [`web/admino/php/admLogout.php`](../../web/admino/php/admLogout.php) `[BO]`            | Logout del backoffice admino                                                                      |

### admino/js · admino/css

| Archivo                                                                               | Propósito                                                                       |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`web/admino/js/admOps_incidents.js`](../../web/admino/js/admOps_incidents.js) `[BO]` | Backoffice fase 1 (OPERACIONES RESERVAS > INCIDENCIAS) — bandeja y detalle.     |
| [`web/admino/css/admOps.css`](../../web/admino/css/admOps.css) `[BO+PV]`              | Backoffice fase 1 (OPERACIONES RESERVAS): incidencias. Complementa css/adm.css. |

## Web · Rutas (.htaccess)

### Reglas reservar / reserva-_ / mi-reserva / mi-cuenta / socperf / mi-perfil-_ / registrar-alojamiento

| Archivo                                                    | Propósito                                                                                                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`web/.htaccess`](../../web/.htaccess)                     | Reglas locales: /reservar/, /reserva-exito, /reserva-cancelada, /reserva-feedback/, /mi-reserva/confirmacion/, /mi-cuenta, /socperf, /mi-perfil-\*, /registrar-alojamiento |
| [`web/production-htaccess`](../../web/production-htaccess) | Reglas de producción equivalentes (bloque 'Booking' + cuenta unificada)                                                                                                    |
| [`web/.htaccess-test`](../../web/.htaccess-test)           | Variante de pruebas del .htaccess                                                                                                                                          |

## Web · Login / sesión (gating de paneles)

### Viajero (soc\*)

| Archivo                                                                                     | Propósito                                                                        |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`web/xx/soclogin.php`](../../web/xx/soclogin.php)                                          | Ruta login viajero                                                               |
| [`web/php/soclogin_body.php`](../../web/php/soclogin_body.php)                              | Formulario login viajero                                                         |
| [`web/php/soclogin_verification.php`](../../web/php/soclogin_verification.php) `[PV]`       | Verificación +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ |
| [`web/xx/soclogout.php`](../../web/xx/soclogout.php)                                        | Ruta logout viajero                                                              |
| [`web/php/soclogout_body.php`](../../web/php/soclogout_body.php)                            | Cierre de sesión viajero                                                         |
| [`web/xx/socregister.php`](../../web/xx/socregister.php)                                    | Ruta registro viajero                                                            |
| [`web/php/socregister_body.php`](../../web/php/socregister_body.php)                        | Formulario registro viajero                                                      |
| [`web/php/socregister_verification.php`](../../web/php/socregister_verification.php) `[PV]` | Cargar variables desde jvariables1 (siempre español para el email)               |

### Anfitrión (us\*)

| Archivo                                                                             | Propósito                                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`web/xx/uslogin.php`](../../web/xx/uslogin.php)                                    | Ruta login anfitrión                                                                                    |
| [`web/php/uslogin_body.php`](../../web/php/uslogin_body.php)                        | Formulario login anfitrión                                                                              |
| [`web/php/uslogin_verification.php`](../../web/php/uslogin_verification.php) `[PV]` | Verificación +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++    |
| [`web/xx/uslogout.php`](../../web/xx/uslogout.php)                                  | Ruta logout anfitrión                                                                                   |
| [`web/php/uslogout_body.php`](../../web/php/uslogout_body.php)                      | Cierre de sesión anfitrión                                                                              |
| [`web/xx/usregister.php`](../../web/xx/usregister.php)                              | Ruta registro anfitrión                                                                                 |
| [`web/php/usregister_body.php`](../../web/php/usregister_body.php)                  | Formulario registro anfitrión                                                                           |
| [`web/php/usregister_sendMail.php`](../../web/php/usregister_sendMail.php) `[PV]`   | Validación de campos legacy.                                                                            |
| [`web/php/uschpwd_update.php`](../../web/php/uschpwd_update.php)                    | Verificacio camps +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ |

### Bootstrap común

| Archivo                                             | Propósito                                                 |
| --------------------------------------------------- | --------------------------------------------------------- |
| [`web/xx/_init.php`](../../web/xx/_init.php) `[PV]` | Bootstrap común de páginas xx/ (sesión, idioma, conexión) |

## Web · Docs (claves jvariables)

### web/docs

| Archivo                                                                                              | Propósito                                                                    |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`web/docs/booking-reservation-emails-keys.txt`](../../web/docs/booking-reservation-emails-keys.txt) | Catálogo email_type — reservas booking                                       |
| [`web/docs/nrf-jvariables-keys.txt`](../../web/docs/nrf-jvariables-keys.txt)                         | Claves jvariables1 — checkout de reserva (prefijo nrf\_\*)                   |
| [`web/docs/bdc-jvariables-keys.txt`](../../web/docs/bdc-jvariables-keys.txt)                         | Claves jvariables1 — panel reservas host (prefijo tab*reservas*\*)           |
| [`web/docs/rooms-jvariables-keys.txt`](../../web/docs/rooms-jvariables-keys.txt)                     | Claves jvariables1 — pestaña Habitaciones host (prefijo tab*habitaciones*\*) |
| [`web/docs/validation-type.md`](../../web/docs/validation-type.md)                                   | Validaciones 'validation_type' ('jtables')                                   |

## Web · Vendor

### SDK Stripe PHP (vendorizado, se lista como carpeta)

| Archivo                                  | Propósito                                                                                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`web/php/stripe`](../../web/php/stripe) | Librería oficial stripe-php (381 archivos). Usada por `php/ussuscription_s_stripe_body.php` (suscripción anfitrión, no reservas). No se detalla archivo por archivo. |

## Deprecado

| Ruta                | Estado                                                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `booking-frontend/` | Frontend React del wizard de reserva. **Deprecado y eliminado del disco** (`fd booking-frontend -d2` sin resultados). Toda la UI vive ahora en PHP + JS del sitio (`web/`). |

## Exclusiones deliberadas (coinciden con la búsqueda por palabra clave pero NO son del sistema de reservas)

| Archivo(s)                                                                                                                                                                                                                                                                                                                                                                                                           | Motivo                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `web/GeoSitesBooking.php`, `web/php/pageHome.php`, `web/php/pageBlogElement.php`, `web/inc/globalFill_destination.php`, `web/inc/global_sqlpre.php`, `web/inc/global_sqlpost.php`, `web/inc/global_block.php`, `web/css/estils.css`, `web/admino/php/admAsignacion.php`, `web/admino/php/admInconsistencias.php`, `web/admino/php/admOctoparseRead.php`, `web/admino/php/admOctoparseSelect.php`, `web/Tasques.todo` | 'booking' = tabla `jbookingsites1` (alojamientos importados de Booking.com), no el motor de reservas |
| `web/php/pageSites.php`, `web/php/pageLanding.php`                                                                                                                                                                                                                                                                                                                                                                   | Solo texto SEO ('Reserva los mejores alojamientos…')                                                 |
| `web/php/*_sendMail.php` de contacto/landings (`pageAnfitriones_`, `pageCertificaciones_`, `pageMarketing_`, `pageSitesElement_`, `socmissing_`, `usmissing_`, `php/legacy/pageSitesElement_sendMail.php`), `web/admino/php/admExportPeticionesSites.php`                                                                                                                                                            | Coinciden por la cuenta SMTP `reservas@…` o `typemail='reserva'`, no por lógica de reservas          |
| `web/php/ussuscription_*` (body, stripe_body, sendMail)                                                                                                                                                                                                                                                                                                                                                              | Suscripción de pago del anfitrión vía Stripe Checkout, flujo distinto a reservas                     |
| `web/class/*` (phpmailer, smtp, pop3, imageResize, image_magician)                                                                                                                                                                                                                                                                                                                                                   | Librerías genéricas; coinciden por palabras como 'reserve'/'checkout' en el código                   |
| `web/css/all.css`, `web/admino/js/jquery*.js`, `web/admino/js/jquery.floatThead/*`                                                                                                                                                                                                                                                                                                                                   | Bundles/vendor; coincidencias accidentales                                                           |
| `web/.cursor/rules/typography-scale.mdc`, `web/.git/**`, `web/fonts/*/OFL.txt`, `*.error.log`, `web/inc/php_errors.log`, `web/php/debug.log`                                                                                                                                                                                                                                                                         | Metadatos, licencias y logs                                                                          |
| `web/docs/sites-jvariables-keys.txt`, `web/docs/sitemap-generator.md`                                                                                                                                                                                                                                                                                                                                                | Listado/sitemap, no reservas                                                                         |
| `web/php/socchpwd_*`, `socconfirmation_*`, `socmissing_body`, `uschpwd_body`, `usconfirmation_*`, `usmissing_body` y sus `xx/`                                                                                                                                                                                                                                                                                       | Recuperación/confirmación de cuenta: auxiliares del login, no gatean los paneles directamente        |
| `web/*.sql` (backups BD), `*.zip`, `*.pdf` de anfitriones                                                                                                                                                                                                                                                                                                                                                            | Volcados y documentos comerciales                                                                    |
| `v4p-translations/**`                                                                                                                                                                                                                                                                                                                                                                                                | Servicio de traducciones; coincidencias por `jbookingsites`/perfiles, no reservas                    |
| `image-optimizer/**`, `uploads-files/**`                                                                                                                                                                                                                                                                                                                                                                             | Microservicios de imágenes/subidas sin referencias al flujo de reservas                              |
| `booking/pnpm-lock.yaml`, PDFs de referencia en `booking/`                                                                                                                                                                                                                                                                                                                                                           | Incluidos en Config por completitud (no se describen)                                                |

## Notas / ambigüedades

- Los docs del panel viajero/backoffice citan `web/xx/mi-cuenta.php` y `web/php/mi_cuenta_body.php`, que **no existen** en disco: la cuenta unificada (2026-10-22) los reemplazó por `xx/socprofile.php` (redirect 302) → `xx/usprofile.php?selTab=tv_*`.
- `web/php/pageSitesElement1.php` parece una variante/copia de `pageSitesElement.php` (incluye `booking_checkout_lib.php`); se lista porque monta el formulario de reserva.
- `booking/src/rooms/` (fuera de `contexts/`) parece código legacy duplicado de `contexts/rooms`.
- **Seguridad:** `web/php/ussuscription_s_stripe_body.php` contiene una clave secreta de Stripe _live_ hardcodeada (no se reproduce aquí). Recomendado rotarla y moverla a variable de entorno.
