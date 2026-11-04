# Handoff para el siguiente agente

Documento de traspaso. No implementa nada. Cada flujo indica la ruta HTTP, quién puede llamarla, el archivo y la función, el cuerpo, y por qué existe.

Fuentes de producto (PDF, no están en el repo):

- Panel del viajero V1 → **instrucciones detalladas:** [HANDOFF-panel-viajero-v1.md](../panel-viajero/HANDOFF-panel-viajero-v1.md).
- Implementación de políticas de cancelación.
- Manual maestro Pagos / Reembolsos / Liquidaciones (30 sep), secciones B1–B17.

Lectura previa en este directorio. No la reescribas; este archivo asume que ya existe:

- [F0-seguridad-y-bugs-criticos.md](F0-seguridad-y-bugs-criticos.md)
- [F1-modelo-economico.md](F1-modelo-economico.md)
- [F2-precio-completo.md](F2-precio-completo.md)

## Convenciones que el código ya cumple

- API Nest en `booking/`. Prefijo de versión por URI (`src/main.ts`, `VersioningType.URI`). Toda ruta de abajo es `/v1/...`.
- El interceptor `src/contexts/shared/interceptors/response.interceptor.ts` envuelve toda respuesta de Nest en `{ ok: true, status, data }`. Los proxies PHP desenvuelven `data` y responden `{ ok, data }` o `{ ok: false, message }`.
- Web PHP en `web/`. El navegador no llama a la API de dinero. Llama a un proxy PHP. El proxy añade `X-Internal-Key` (`bw_internal_key` en `web/inc/booking_wizard_lib.php`) y la base `BOOKING_INTERNAL_URL` o `BOOKING_URL` + `/v1` (`bw_api_base`, misma librería).
- Campos de entidades TypeORM: `snake_case`. Resto del TS/JS: `camelCase`. Updates de fila: `preload()` + `save()`.
- Textos nuevos de la web: variables `jvariables`, no literales. Español es la base; traducciones solo si `lang !== es`.
- No guardar PAN ni CVC.

## Quién puede llamar qué

| Tipo                      | Guard                                                                                                     | Cómo llega                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Público (navegador → API) | ninguno                                                                                                   | quote, checkout, calendario, feedback, `GET /reservations/:id?session_id=` |
| Interno                   | `InternalApiKeyGuard` (`src/contexts/shared/guards/internal-api-key.guard.ts`), cabecera `X-Internal-Key` | proxies PHP y jobs                                                         |
| Stripe                    | firma `Stripe-Signature`                                                                                  | `POST /v1/webhook`                                                         |

El anfitrión se identifica en PHP con `$_SESSION['client']` (site) y `$_SESSION['user_id']`. El viajero autenticado, con `$_SESSION['user_id']`. Esos ids los pone el proxy en el body. No los aceptes del query string si añades rutas nuevas.

CSRF de los proxies: cabecera `X-CSRF-Token` igual a `$_SESSION['fsc_csrf']`. Lo genera `bw_csrf_token()` en `web/inc/booking_wizard_lib.php`.

---

## 1. Checkout del viajero (cobro inmediato)

### Por qué

El manual B7 dice: calcular importe y snapshot, intentar el cobro, y solo si Stripe confirma, confirmar la reserva y bloquear fechas. Si falla, no hay reserva confirmada ni fechas bloqueadas. Por eso el checkout crea la fila (hace falta el id para Stripe y el snapshot) pero no llama a `setNightsAvailability(false)`.

`charge_mode` vale `immediate` en todo checkout nuevo. `flexible` está en el enum para el cobro diferido y no tiene jobs. Migración: `src/database/migrations/1791100000000-charge-mode-immediate.ts`. Columna en `src/contexts/reservations/entities/reservation.entity.ts`.

### Ruta pública de cotización

`POST /v1/reservations/quote`

- Controlador: `ReservationController.quote` en `src/contexts/reservations/api/reservation.controller.ts`.
- Servicio: `ReservationService.quoteReservation` en `src/contexts/reservations/services/reservation.service.ts`.
- Precio: una sola función pura, `buildReservationQuote` en `src/contexts/reservations/utils/reservation-quote.util.ts`, que usa `src/contexts/payments/domain/reservation-pricing.ts`. Quote y checkout no pueden divergir.
- DTO: `src/contexts/reservations/dto/quote-reservation.dto.ts` (fechas, room, perros, servicios, extras).
- Respuesta pública: `toPublicQuote`. Quita el payload interno (`internal`) que el checkout sí usa. El navegador no debe ver claves de idempotencia ni desglose de comisión interno.

### Ruta pública de cobro

`POST /v1/reservations/checkout`

- Controlador: `ReservationController.checkout`.
- DTO: `src/contexts/reservations/dto/checkout-reservation.dto.ts`. Incluye `traveler_token`.
- Identidad: `resolveTravelerUserId` verifica el token con `src/contexts/reservations/utils/traveler-token.util.ts`. El PHP lo firma en `bookingTravelerToken` de `web/inc/booking_checkout_lib.php` (HMAC, mensaje `v4p-traveler:v1:{user_id}:{exp}`). Si el token falta o es inválido, la reserva queda como invitado (`user_id = 0`), no se fía del id que mande el JS.
- Secuencia dentro de `checkout`:
  1. `quoteReservation`. Si `valid` es falso, 422 si el problema es solo de perros (`dogs_incompatible`) o 400 en otro caso.
  2. `economics.resolveFrozenTerms()` y `loadSnapshotRoom`.
  3. `createPendingFromCheckout`: inserta reserva `status=pending`, `payment_status=pending`, `charge_mode=immediate`, líneas, pago `pending_charge` y snapshot v1. No bloquea noches.
  4. `StripeService.createSitePaymentLink` (`src/contexts/stripe/services/stripe.service.ts`). Clave de idempotencia `checkout:{reservationId}` en `src/contexts/stripe/utils/stripe-idempotency.util.ts`.
  5. Si Stripe no crea la sesión, `expirePendingReservation(..., "checkout_session_failed")`: pago `failed`, reserva `cancelled`, sin soltar inventario que nunca se tomó.
- Respuesta al navegador: `{ reservation_id, checkout_url, expires_at }`. El JS redirige a `checkout_url`.

### Web que llama a esas rutas

- Formulario: `web/components/reservation_book_wizard.php` (pasa `travelerToken`).
- JS: `web/js/booking_reservation_checkout.js`. Postea quote y checkout al API público (no pasa por `booking_traveler_api.php`).
- Ficha del alojamiento que incrusta el wizard: `web/php/pageSitesElement.php`.

### Calendario público

`GET /v1/reservations/public/rooms/:room_id/calendar?from=&to=`

- `ReservationController.getPublicRoomCalendar` → `ReservationService.getPublicRoomCalendar`.
- Devuelve disponibilidad, bloqueos y reservas que ocupan fechas. El filtro es `isReservationBlockingInventory` en `src/contexts/reservations/utils/reservation-policy.util.ts`.
- Regla actual: `cancelled` no ocupa. `paid`, `confirmed` y `finalized` ocupan. Un `pending` impagado **no** ocupa, aunque tenga `expiration_date`. Así dos viajeros pueden iniciar checkout de las mismas noches; el primero que pague se las queda.

### Página de éxito

`GET /v1/reservations/:id?session_id=`

- `ReservationController.getPublicSummary` → `ReservationService.getPublicSummary`.
- Sin `session_id` igual a `reservations.stripe_checkout_session_id` responde 404. El id de reserva es secuencial y no debe filtrar datos.

### Alta manual interna (no es el checkout del viajero)

`POST /v1/reservations` con `X-Internal-Key`.

- `ReservationController.create` → `ReservationService.create`.
- DTO: `src/contexts/reservations/dto/create-reservation.dto.ts`.
- Sigue el camino viejo: `holdInventoryAndInsert` bloquea las noches en la misma transacción. No lo cambies al tocar el checkout público.

---

## 2. Webhook de Stripe

`POST /v1/webhook`

- Controlador: `src/contexts/webhook/api/webhook.controller.ts`. Exige `Stripe-Signature`. El body llega en crudo (`src/main.ts` monta `express.raw` solo en `/v1/webhook`).
- Orquestación: `WebhookService.dispatch` en `src/contexts/webhook/services/webhook.service.ts`.
- Idempotencia del evento: tabla `stripe_webhook_events` (`src/contexts/webhook/entities/stripe-webhook-event.entity.ts`). Un `evt_` ya procesado no se reejecuta. Por eso Stripe puede reenviar sin duplicar cobros.
- Efectos de reserva: `src/contexts/webhook/services/reservation-webhook.service.ts`.

| Evento                                                                   | Método                                        | Qué hace                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `checkout.session.completed`, `checkout.session.async_payment_succeeded` | `handleCheckoutCompleted`                     | Si está pagada, `activateFromPayment`. Si el método es asíncrono y aún no está pagada, pago → `processing`.                                                                                                                                            |
| `checkout.session.expired`, `checkout.session.async_payment_failed`      | `handleCheckoutExpired`                       | Pago `failed`, reserva `cancelled`. Libera noches solo si esa reserva las tenía tomadas y ninguna otra reserva que bloquee calendario las cubre.                                                                                                       |
| `refund.created`, `refund.updated`, `refund.failed`                      | `handleRefundEvent`                           | `PaymentLedgerService.syncRefundFromStripe`. `succeeded` → `partial_completed` o `total_completed`. `failed`/`canceled` → `failed`, revierte columnas legacy y deja la obligación abierta. Aquí se dispara el email de reembolso completado o fallido. |
| `charge.refunded`                                                        | `handleChargeRefunded`                        | Actualiza `amount_refunded` y `payment_status` legacy (`refunded` / `partially_refunded`). Si el payload trae `refunds.data`, sincroniza esas filas.                                                                                                   |
| `charge.dispute.created`                                                 | `handleChargeDisputeCreated`                  | Payout `blocked`.                                                                                                                                                                                                                                      |
| `charge.dispute.closed`                                                  | `handleChargeDisputeClosed`                   | Si se gana y no hay otra disputa, vuelve a `held`.                                                                                                                                                                                                     |
| `transfer.created`                                                       | `handleTransferCreated`                       | Sincroniza payout liberado. Stripe manda si el transfer ya existía.                                                                                                                                                                                    |
| `account.updated`                                                        | `expressAccountsService.handleAccountUpdated` | Cuenta Connect del anfitrión.                                                                                                                                                                                                                          |

### Activar una reserva pagada

`ReservationService.activateFromPayment` (`reservation.service.ts`).

1. Bloquea la fila de la reserva (`pessimistic_write`).
2. Mismo `payment_intent` y ya no está `pending`: no-op (`ALREADY_ACTIVE`).
3. Importe distinto al esperado (`expectedChargeCents` en `src/contexts/reservations/utils/reservation-amount.util.ts`): reembolso automático `amount_mismatch`.
4. Otro pago cuando ya no está `pending`: reembolso `duplicate_payment`.
5. Reserva `pending`: `SELECT … FOR UPDATE` de las noches. Si están libres, `confirmPaid` (`status=confirmed`, `payment_status=paid`, payout `held`) y `setNightsAvailability(false)`. Si no, reembolso `payment_after_expiry_dates_unavailable`.
6. Reserva ya `cancelled` (expiró y el pago llegó tarde): intenta recuperar las noches. Si otra reserva las tiene, reembolsa. Si siguen libres, reactiva y bloquea.
7. Cualquier otro estado: reembolso `invalid_state`.

Esos reembolsos automáticos viven en `refundUnhonoredPayment` del mismo servicio. Crean fila `refunds` en `processing` con `responsible=platform` y llaman a Stripe. El webhook cierra el estado.

Ledger que toca el webhook, todo en `src/contexts/payments/services/payment-ledger.service.ts`:

- `createPayment`, `attachCheckoutSession`, `transitionPayment`
- `recordPaymentSucceeded`, `recordPaymentProcessing`, `recordPaymentFailed`
- `recordRefundCreated`, `recordRefundPending`, `syncRefundFromStripe`

Cada transición pasa por la máquina. Misma transición = no-op. Transición inválida de un comando = error + `audit_log`. Evento de Stripe fuera de orden = se audita y se ignora (no se devuelve 500, Stripe reintentaría días).

---

## 3. Cancelación y reembolsos que ya existen

### 3.1 Viajero cancela

Proxy: `POST web/php/booking_traveler_api.php?action=reservation_cancel_traveler`

- Exige sesión `user_id` y CSRF.
- Body JSON: `{ reservation_id, cancellation_reason, notes? }`.
- Motivos que el PHP y el DTO aceptan, y ningún otro: `voluntary`, `illness_person`, `illness_pet`, `death_person`, `death_pet`, `force_majeure`. Lista en `TRAVELER_CANCELLATION_REASONS` de `src/contexts/reservations/utils/refund-policy.util.ts`. El PHP repite la lista en `booking_traveler_api.php`; si amplías una, amplía la otra.
- El proxy fuerza `user_id` desde la sesión y reenvía `POST /v1/reservations/:id/cancel-traveler`.

API: `ReservationController.cancelByTraveler` → `ReservationRefundService.cancelByTraveler` en `src/contexts/reservations/services/reservation-refund.service.ts`.

DTO: `src/contexts/reservations/dto/traveler-cancel-reservation.dto.ts` (`user_id`, `cancellation_reason`, `notes?`).

Qué hace, en una transacción con la fila bloqueada:

- La reserva tiene que ser del `user_id`. Si no, 403.
- `pending` impagada: cancela, pago `failed` (`cancelled_by_traveler`), libera noches solo si las tenía. No hay refund.
- `confirmed` + `paid`, payout no `released` ni `blocked`, y antes del checkout: sigue.
- `force_majeure`: `recordRefundPending` (estado `pending`, sin Stripe). Clave `refund-pending:{reservationId}:{pendingId}`. Abre `reservation_disputes` (`openForceMajeureDispute`, `source=guest_report`, JSON `type=force_majeure_cancellation`). Email admin `force_majeure_review_admin` en `reservation-email.service.ts`.
- Otro motivo y `isWithinSnapshotRefundWindow` verdadero: `ReservationPayoutService.refundInTransaction` por el importe cobrado entero (`resolveTravelerRefundAmountCents` hoy ignora la penalización).
- Otro motivo fuera de plazo: cancela sin refund.
- Siempre que cancele: `status=cancelled`, `cancel_reason`, evento `cancelled`, email de cancelación con el flag de refund **en false**. El email de “reembolso hecho” no sale aquí.

El plazo no es la política del PDF. `resolveSnapshotRefundDeadlineIso` lee `snapshot.refund_policy.refund_deadline`. Si no hay snapshot, cae a `getRefundDeadlineUtc`: 24 h antes del check-in en UTC (`REFUND_WINDOW_MS` en `reservation-policy.util.ts`). Ese deadline lo escribe `buildRefundRule` en `src/contexts/payments/domain/reservation-snapshot.ts` con `rule = legacy_host_full_refund_until_24h_before_checkin`. El campo `refund_policy.cancellation` existe en el tipo y **no se rellena**.

### 3.2 Anfitrión pide reembolso excepcional

Proxy: `POST web/php/booking_host_api.php?action=reservation_exceptional_refund`

- Body: `{ reservation_id, amount_cents, reason, notes? }`. `site_id` lo pone el proxy desde la sesión, no el JS.
- JS: `web/js/booking_reservations_list.js` (`data-action="exceptional-refund"`). Textos: `web/components/usprofile_reservations_tab.php`.
- Reenvía `POST /v1/reservations/:id/exceptional-refund`.

API: `ReservationController.requestExceptionalRefund` → `ReservationRefundService.requestExceptionalRefund`.

DTO: `src/contexts/reservations/dto/exceptional-refund-request.dto.ts` (`site_id`, `amount_cents` ≥ 1, `reason`, `notes?`).

Reglas: solo `confirmed` + `paid`. El importe no puede superar lo cobrado menos lo ya reembolsado. Crea `refunds` en `pending` con `requested_by = host`. No llama a Stripe.

El anfitrión ya no tiene acción de cancelar la reserva en ese proxy. `POST /v1/reservations/:id/cancel` sigue existiendo (`ReservationLifecycleService.cancelReservation`) para usos internos antiguos; el panel no lo llama. No vuelvas a pintar “Cancelar reserva” ni “Aceptar reserva” en el panel del alojamiento.

### 3.3 V4P aprueba o rechaza un refund pending

`POST /v1/refunds/:refund_id/review` con `X-Internal-Key`.

- Controlador: `src/contexts/reservations/api/refunds.controller.ts` (`RefundsController.reviewPendingRefund`).
- DTO: `src/contexts/payments/dto/review-refund.dto.ts`. Body: `{ decision: "approve" | "reject", admin_notes? }`.
- Servicio: `ReservationRefundService.reviewPendingRefund`.
- `approve`: pasa la fila a `processing` y llama a `refunds.create` de Stripe con clave nueva `refund:{reservationId}:{n}`.
- `reject`: estado `failed`. No hay cargo ni devolución.
- No hay proxy PHP de backoffice. Hoy se llama la API directo con la clave interna.

### 3.4 Cómo se crea el refund en Stripe

`ReservationPayoutService.refundInTransaction` en `src/contexts/reservations/services/reservation-payout.service.ts`.

- Exige `stripe_payment_intent_id`.
- Secuencia `reservation.refund_seq + 1`, clave `refund:{id}:{n}` (`stripeIdempotencyKeys.refund`).
- Escribe la fila con `recordRefundCreated` en estado `processing` dentro de la misma transacción.
- Escribe de forma optimista `payment_status` legacy (`refunded` o `partially_refunded`) y `amount_refunded` porque el PHP los lee. Si llega `refund.failed`, el webhook lo revierte.
- El email `refund_processed_*` no se manda aquí. Se manda en `handleRefundEvent` cuando Stripe dice `succeeded`. `refund_failed_*` cuando dice `failed`.

### 3.5 Máquinas (no las cambies de pasada)

- Pago B3: `src/contexts/payments/domain/payment-state-machine.ts`. Estados: `method_validated`, `pending_charge`, `processing`, `paid`, `failed`, `pending_regularization`, `definitive_unpaid`. En uso hoy: `pending_charge`, `processing`, `paid`, `failed`. El resto espera al cobro diferido.
- Reembolso B4: `src/contexts/payments/domain/refund-state-machine.ts`. `none`, `pending`, `processing`, `partial_completed`, `total_completed`, `failed`. `paid` del pago no se mueve por un refund.
- Payout legacy: `held` | `blocked` | `released` en la misma carpeta (`payout-state-machine.ts`). `deriveLiquidationStatus` traduce eso a los estados B5 para lectura. No hay lote semanal ni tabla de liquidación.

---

## 4. Snapshot, líneas y auditoría

Se escriben en la misma transacción que el insert de la reserva (`ReservationService.economicsHook` → `ReservationEconomicsService.recordNewReservation`).

| Pieza                | Archivo                                                                                                         | Para qué                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Líneas inmutables    | `src/contexts/payments/entities/reservation-price-line.entity.ts`                                               | Alojamiento, régimen, perros, extras. Flags `is_commissionable`, `is_penalizable`, `is_optional`. Una corrección es una línea `adjustment` nueva.                  |
| Snapshot append-only | `src/contexts/payments/entities/reservation-snapshot.entity.ts`                                                 | `reservation_id` + `version` únicos. Razones: `checkout`, `manual_create`, `legacy_backfill`.                                                                      |
| Payload              | `buildReservationSnapshotPayload` en `reservation-snapshot.ts`                                                  | Estancia, unidad, perros declarados, política Dog Friendly, servicios, extras, fianza informativa, totales, comisión, `refund_policy`.                             |
| Pago                 | `src/contexts/payments/entities/payment.entity.ts`                                                              | Id interno, estado B3, céntimos, `stripe_checkout_session_id`, `stripe_payment_intent_id`, `stripe_charge_id`, `idempotency_key` única, intentos, error.           |
| Refund               | `src/contexts/payments/entities/refund.entity.ts`                                                               | Id, motivo, importe, solicitante, aprobador, `responsible` (`host` \| `platform` \| `traveler`), `stripe_refund_id`, clave única.                                  |
| Auditoría            | `src/contexts/payments/entities/audit-log.entity.ts` y `audit-log.service.ts`                                   | Append-only. Actor, acción, before/after, metadata. No hay update ni delete.                                                                                       |
| Comisión congelada   | columnas `commission_rate`, `commission_cents`, `total_cents`, `snapshot_version`, `timezone` en `reservations` | `commission_cents` es lo que se retiene al anfitrión. `reservations.commission` (decimal legacy) es un recargo al viajero y en el checkout va a 0. No las mezcles. |

Perros del snapshot: `SnapshotDog` (índice, nombre, peso, PPP, talla derivada). Condiciones Dog Friendly: `SnapshotDogPolicy` en el mismo archivo. El checkout las copia para que un cambio posterior del perfil o del alojamiento no altere la reserva. Eso ya cumple la regla del panel (“mostrar lo declarado, no lo actual”).

---

## 5. Panel del anfitrión (no es el panel del viajero)

Página: `web/xx/usprofile.php` → `web/php/usprofile_body.php`. Es la cuenta del alojamiento (Club/site), con pestañas de perfil, reservas y habitaciones.

| UI                                                                                      | Proxy `?action=`                                     | API                                                                                                        |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `web/components/usprofile_reservations_tab.php` + `web/js/booking_reservations_list.js` | `GET reservations` (`from`, `to`)                    | `GET /v1/reservations/by-site/:site_id/range`                                                              |
| Mismo JS, botón reembolso excepcional                                                   | `POST reservation_exceptional_refund`                | `POST /v1/reservations/:id/exceptional-refund`                                                             |
| Finalizar estancia                                                                      | `POST reservation_finalize`                          | `POST /v1/reservations/:id/finalize` → `ReservationLifecycleService.finalizeReservation`                   |
| `web/components/usprofile_stripe_connect.php` + `web/js/booking_stripe_connect.js`      | `GET stripe_status`, `POST stripe_onboarding`        | `GET /v1/stripe/connect-status/:user_id`, `POST /v1/stripe/express-account`                                |
| `web/components/usprofile_rooms_tab.php` + `web/js/booking_rooms_dashboard.js`          | `rooms`, `room_create`, `room_update`, `room_delete` | `/v1/rooms/...` (`src/contexts/rooms/api/rooms.controller.ts`)                                             |
| Disponibilidad y bloqueos                                                               | `availability_*`, `block_*`                          | `src/contexts/availability/api/availability.controller.ts`, `src/contexts/blocks/api/blocks.controller.ts` |

Lista blanca y el switch están al inicio de `web/php/booking_host_api.php`. Si añades una acción del anfitrión, va ahí y el `site_id` sale de la sesión.

Valoración de estancia (no está dentro de una cuenta): `GET` y `POST /v1/reservations/feedback/:token`. Servicio `src/contexts/reservations/services/reservation-feedback.service.ts`. El token se crea al finalizar. El panel del viajero, cuando exista, debe reutilizar este módulo, no crear otro cuestionario.

Wizard de alta del alojamiento (política de perros, unidades, servicios): `src/contexts/site-wizard/api/site-wizard.controller.ts`, prefijo `/v1/site-wizard`. No guarda políticas de cancelación por tarifa.

---

## 6. Motor de políticas: existe y no está conectado

Archivo: `src/contexts/payments/domain/cancellation-policy.ts`. Tests: `tests/unit/contexts/payments/cancellation-policy.test.ts`.

Funciones puras ya escritas. Úsalas; no copies el cálculo:

- `assertCancellationPolicy`: valida la combinación.
- `freeCancellationDeadlineIso` y `endOfLocalDayUtcIso`: deadline exacto en la timezone del alojamiento.
- `quoteCancellation`: devuelve `within_free_period`, `deadline_iso`, `penalty_cents`, `refund_cents`, `generated_text`.
- `generateCancellationText` y `formatPenaltyPreview`: el texto sale de los campos, no de un textarea.

Catálogo que ya codifica el PDF:

- Tipos: `free_cancellation`, `partial_from_booking`, `non_refundable`.
- Días: `FREE_CANCELLATION_DAYS = [1, 3, 7, 14, 30]`.
- Penalización: `percent_100`, `percent_50`, `first_night`.
- No-show: `same_as_cancellation`, `full_total`.
- Gracia (apagada): `GRACE_AFTER_BOOKING_HOURS = [1, 4, 24]`. Anticipada: `EARLY_CANCELLATION_WEEKS = [4, 8, 12]`.

`SnapshotRefundRule` en `reservation-snapshot.ts` ya tiene `cancellation?` y `generated_text?`. `buildRefundRule()` no los asigna. Checkout, quote y `cancelByTraveler` no importan este módulo salvo el tipo.

No hay tabla de políticas, no hay entidad tarifa, no hay UI del alojamiento para elegirla, no hay preview de cancelación.

---

## 7. Qué hay que construir, y en qué engancharlo

No reimplementes el ledger, el webhook ni el checkout inmediato. Engancha aquí.

### 7.1 Política por tarifa

Modelo del PDF: alojamiento → unidad → tarifa → política estructurada. Una unidad puede tener dos tarifas (precio distinto, política distinta). Prohibido un texto libre.

Al cablear:

1. Persistir catálogo y la política de cada tarifa. Los plazos siguen siendo datos, no `if` en la UI.
2. En `quoteReservation` y en el wizard (`booking_reservation_checkout.js`, antes del botón de pago) mostrar tipo, deadline exacto (fecha y hora, timezone del alojamiento) y penalización. No reembolsable va destacado.
3. En `buildRefundRule` / `buildReservationSnapshotPayload`, copiar el objeto `CancellationPolicyDefinition` a `refund_policy.cancellation` y el texto a `generated_text`, y guardar el deadline calculado en `refund_deadline`. Un cambio posterior de la tarifa no hace `UPDATE` de snapshots viejos.
4. Reservas sin `cancellation` (las de ahora) siguen con la regla de 24 h. No las reescribas.
5. `cancelByTraveler` debe usar el quote del módulo y reembolsar `refund_cents`, no `expectedChargeCents`.
6. Nuevo endpoint interno de preview, sin efectos, que devuelva penalización, importe a devolver y si se libera la unidad. El proxy del viajero lo llama antes de `reservation_cancel_traveler`. La pantalla del PDF es: penalización de hoy, importe a devolver, botón confirmar.
7. Tests del PDF que el módulo aún no cubre de punta a punta: C01–C06, C09, C11–C13.

Cobro y política son módulos distintos (sección 15 del PDF):

- No reembolsable → el cobro inmediato actual del 100 % encaja.
- Gratis hasta X días → el cargo recomendado es al acabar el plazo. Eso es `charge_mode=flexible` y **no se implementa** hasta cerrar el diferido. No cobres el 100 % al momento y a la vez prometas “sin cargo hasta el día X” sin decirlo.
- Parcial desde la reserva → cobrar la penalización según el calendario que se defina; tampoco está el job.

### 7.2 Motivos de cancelación del panel

El panel pide más motivos que los seis códigos. La economía no depende del motivo; depende del snapshot. Solo la circunstancia excepcional deja el refund en `pending` y exige explicación y adjuntos (hoy `notes` es un string de hasta 1000 caracteres en el proxy, sin ficheros).

Al ampliar `TRAVELER_CANCELLATION_REASONS`, actualiza el DTO, el array `$allowed` de `booking_traveler_api.php` y los textos `jvariables`.

### 7.3 Cuenta del viajero

No existe. No uses `usprofile` (eso es el alojamiento). La cuenta del Club pasa a ser también la del viajero. No hay ruta PHP de “mis reservas del viajero”; solo el proxy de cancelación.

Hay que crear, como mínimo:

- Listado del viajero (próximas / pasadas / canceladas) leyendo reservas por `user_id` de sesión. Hoy `GET /v1/reservations/by-site/:site_id/range` es del anfitrión. Hace falta un `GET` interno por viajero, más un proxy nuevo al estilo de `booking_traveler_api.php` (sesión + CSRF + clave interna). No abras ese GET al público.
- Detalle que lea el snapshot (`reservation_snapshots` última versión) y las filas `payments` / `refunds`, no la ficha viva. Estados visibles: Confirmada, Pago pendiente, Cancelada, Estancia finalizada, Incidencia en revisión. No muestres `pending_charge` ni `processing`.
- Cancelar usando el preview del punto 7.1.
- Mis perros reutilizables (nombre, peso, PPP, foto opcional). Editar el perro no toca snapshots.
- Inicio: próximo viaje y alertas que ya se puedan calcular (deadline del snapshot). “Actualizar método de pago” no se muestra mientras solo exista `immediate`.
- Solicitud de cambio (noches, fechas, viajeros, perros, extras, otro) que no modifica la reserva hasta que el viajero acepte una propuesta y, si hay que pagar, Stripe cobre. Aceptar = snapshot `version+1`, no update del payload anterior.
- “Tengo un problema con mi reserva” con adjuntos y estados Recibida → En revisión → Necesitamos información → Resuelta. Si bloquea dinero, usa el payout `blocked` de esa reserva, no del alojamiento entero.
- Alternativa si el alojamiento no puede alojar: el viajero acepta o rechaza. No es `cancel` del anfitrión.
- Valoración: reutilizar `/v1/reservations/feedback/:token`.
- Club y puntos: solo hueco de menú. No generes puntos.

### 7.4 Sigue fuera de este encargo

- Jobs del diferido: deadline 18:00, ventana de 12 h, `method_validated`, `pending_regularization`, `definitive_unpaid`, deuda del viajero. Los estados ya están en la máquina; no los borres.
- Liquidación semanal, payouts por lote, +24 h. `deriveLiquidationStatus` es solo lectura.
- Colas de backoffice (no-show, disputas, payouts fallidos) más allá de `POST /v1/refunds/:id/review`.
- Matriz fina de roles. Nadie borra historial económico.

---

## 8. Tests y migración

```bash
npx vitest run --config vitest.config.unit.ts
```

Carpetas: `tests/unit/contexts/payments/`, `tests/unit/contexts/reservations/`, `tests/unit/contexts/webhook/`.

En cada entorno, si no se ha corrido: migración `1791100000000-charge-mode-immediate` (`npm run migration:run` en booking). Sin esa columna, cualquier select de `reservations` falla.
