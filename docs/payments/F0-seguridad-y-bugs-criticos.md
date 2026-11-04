# F0 — Seguridad y bugs críticos de pagos

Fase 0 del plan de pagos V4P. Objetivo: cerrar los agujeros de seguridad de la
booking API (rutas de anfitrión abiertas al navegador) y los bugs que podían
perder dinero, cobrar dos veces o vender la misma noche dos veces.

> **Antes de desplegar:** ejecutar la migración `1791000000000-payments-f0-hardening`.
> Sin ella la API falla con `Unknown column 'ReservationEntity.refund_seq'`
> en cualquier consulta de reservas (el código ya usa las columnas nuevas).

---

## 1. Qué cambia y por qué

| #    | Cambio                                                                                                                                                                                                                                                                                                 | Por qué                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1  | Todas las rutas no públicas llevan `InternalApiKeyGuard` (`X-Internal-Key`). El navegador del anfitrión pasa por el proxy PHP `web/php/booking_host_api.php`.                                                                                                                                          | Cualquiera podía listar reservas (con email/teléfono de huéspedes), cancelar/reembolsar, finalizar, crear cuentas Stripe o editar habitaciones de **cualquier** site llamando directamente a la API. |
| 0.1  | Nuevo endpoint público `GET /v1/reservations/public/rooms/:room_id/calendar` (solo fechas ocupadas).                                                                                                                                                                                                   | El calendario del checkout público usaba `GET /reservations/by-site/:id/range`, que devolvía datos personales de otros huéspedes.                                                                    |
| 0.1  | `GET /v1/reservations/:id` exige `?session_id=cs_...` (el de Stripe) y devuelve solo código, estado, fechas y total.                                                                                                                                                                                   | Los ids son secuenciales: se podían enumerar reservas y leer nombre del huésped e importes.                                                                                                          |
| 0.2  | Eliminados `PATCH /v1/reservations/:id` (confirmaba y marcaba **pagada** sin pago) y `DELETE /v1/reservations/:id`. `POST /v1/reservations` pasa a interno.                                                                                                                                            | Nadie legítimo los usaba (inventario hecho con `rg`); eran una puerta para reservar gratis o cancelar reservas ajenas.                                                                               |
| 0.3  | `stripe/express-account`, `stripe/connect-status`, `stripe/site-payment-link` internos. `user_id` y `site_id` salen de la sesión PHP; el backend comprueba que el usuario es dueño del site.                                                                                                           | Antes el navegador enviaba `user_id` → se podía crear/ver la cuenta Connect de otro anfitrión.                                                                                                       |
| 0.4  | TTL de reserva pendiente único (`PENDING_RESERVATION_EXPIRATION_TIME`, 31 min por defecto, mínimo 31 min) usado para `reservation.expiration_date` **y** `expires_at` de la Checkout Session. Webhook `checkout.session.expired` (y `async_payment_failed`) cancela la pendiente de forma idempotente. | Antes la reserva caducaba a los 15 min pero la sesión de Stripe duraba 24 h: el cliente podía pagar una reserva ya cancelada.                                                                        |
| 0.5  | Pago recibido sobre reserva cancelada/expirada: si las noches siguen libres → se **reactiva** (bloqueo de inventario en transacción); si no → **reembolso total automático** con idempotency key, evento de auditoría y email al huésped + admin.                                                      | Antes solo se hacía `logger.warn`: dinero cobrado sin reserva.                                                                                                                                       |
| 0.6  | Webhooks con ciclo de vida persistido (`received/processing/processed/failed`, `attempts`, `last_error`), procesado en **una transacción**, respuesta no-2xx si falla.                                                                                                                                 | Antes el evento se guardaba _después_ de procesar sin transacción y los errores se tragaban (`try/catch` + 200): un fallo = evento perdido para siempre.                                             |
| 0.7  | Idempotency keys en toda mutación Stripe + bloqueo de fila (`SELECT ... FOR UPDATE`) en cancelar/reembolsar/liberar payout/finalizar. Transfer buscado por `transfer_group` antes de crear.                                                                                                            | Doble clic o cron + feedback simultáneos podían reembolsar o transferir dos veces.                                                                                                                   |
| 0.8  | Disputas: `charge.dispute.created` bloquea el payout; `charge.dispute.closed` lo desbloquea si se gana y no hay otra disputa/reporte abierto, lo mantiene si se pierde. `charge.refunded` distingue parcial/total y ya no duplica el email.                                                            | Antes la disputa solo mandaba un email; el payout se liberaba igual.                                                                                                                                 |
| 0.9  | Anti-overbooking: comprobación + insert + actualización de inventario en **una transacción** con `SELECT ... FOR UPDATE` sobre las filas de `availability` (índice único `site_id, room_id, date`).                                                                                                    | Dos checkouts simultáneos de la misma habitación/fechas podían pasar ambos.                                                                                                                          |
| 0.10 | `calcNights`/`getNightDates` con aritmética UTC; `getPublicSummary` (lógica invertida que devolvía `null` en importes); cron de payouts reintenta releases fallidos aunque haya review; sin efectos secundarios en GET.                                                                                | Estancias sobre el cambio de hora contaban 1 noche menos; importes nunca visibles; un release fallido tras review se quedaba bloqueado para siempre; un GET cancelaba reservas.                      |

---

## 2. Clasificación de endpoints

**Públicos** (navegador del viajero / infraestructura). Lista cerrada y verificada por
`tests/unit/contexts/shared/guard-coverage.test.ts`: añadir una ruta pública exige tocar el test.

| Método   | Ruta                                                      | Uso                               | Datos                                                                                         |
| -------- | --------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| GET      | `/health`                                                 | healthcheck                       | —                                                                                             |
| POST     | `/v1/webhook`                                             | Stripe (firma `Stripe-Signature`) | —                                                                                             |
| POST     | `/v1/reservations/quote`                                  | checkout                          | presupuesto                                                                                   |
| POST     | `/v1/reservations/checkout`                               | checkout                          | `reservation_id`, `checkout_url`, `expires_at`                                                |
| GET      | `/v1/reservations/public/rooms/:room_id/calendar?from&to` | calendario checkout (**nuevo**)   | disponibilidad, bloqueos (fechas/tipo), rangos ocupados. Sin datos de huésped. Máx. 400 días. |
| GET      | `/v1/reservations/:id?session_id=cs_...`                  | página `reserva-exito`            | id, código, estado, estado de pago, fechas, total. 404 si `session_id` no coincide.           |
| GET/POST | `/v1/reservations/feedback/:token`                        | página de valoración              | protegido por token aleatorio (hash en BD)                                                    |
| GET      | `/v1/rooms/by-site/:site_id/public`                       | ficha / checkout                  | habitaciones activas                                                                          |

**Internas** (`X-Internal-Key`). Desde el navegador del anfitrión solo vía proxy
`web/php/booking_host_api.php?action=…`; desde PHP servidor vía `bw_api_request()`.

| Método                | Ruta                                                                 | Acción del proxy / llamador PHP                                                                                                    |
| --------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| GET                   | `/v1/reservations/by-site/:site_id/range`                            | `reservations`                                                                                                                     |
| POST                  | `/v1/reservations/:id/cancel`                                        | `reservation_cancel` (`site_id` de sesión)                                                                                         |
| POST                  | `/v1/reservations/:id/finalize`                                      | `reservation_finalize` (`site_id` de sesión)                                                                                       |
| POST                  | `/v1/reservations`                                                   | — (manual/interno)                                                                                                                 |
| GET                   | `/v1/stripe/connect-status/:user_id[?site_id]`                       | `stripe_status` (user+site de sesión, comprueba propiedad) · `inc/booking_checkout_lib.php` (elegibilidad checkout, sin `site_id`) |
| POST                  | `/v1/stripe/express-account`                                         | `stripe_onboarding` (`user_id`, `site_id` de sesión, `return_to` = `profile`\|`wizard`)                                            |
| POST                  | `/v1/stripe/site-payment-link`                                       | — (lo usa `checkout` internamente)                                                                                                 |
| GET                   | `/v1/rooms/by-site/:site_id`                                         | `rooms` · `inc/booking_room_photos_lib.php`                                                                                        |
| POST                  | `/v1/rooms`                                                          | `room_create`                                                                                                                      |
| PATCH                 | `/v1/rooms/:id`                                                      | `room_update` (propiedad verificada) · `inc/booking_room_photos_lib.php`                                                           |
| DELETE                | `/v1/rooms/:id`                                                      | `room_delete` (propiedad verificada)                                                                                               |
| GET                   | `/v1/availability`, `/v1/availability/:id`                           | uso interno del proxy (verificar propiedad)                                                                                        |
| GET                   | `/v1/availability/by-site/:id/range`, `/by-room/:id/range`           | `availability_range`                                                                                                               |
| POST                  | `/v1/availability`                                                   | `availability_create`                                                                                                              |
| PATCH                 | `/v1/availability/:id`                                               | `availability_update` (propiedad verificada)                                                                                       |
| DELETE                | `/v1/availability/:id`                                               | —                                                                                                                                  |
| GET                   | `/v1/blocks`, `/v1/blocks/:id`                                       | uso interno del proxy                                                                                                              |
| GET                   | `/v1/blocks/by-site/:id`, `/by-site/:id/range`, `/by-room/:id/range` | `blocks`, `blocks_range`                                                                                                           |
| POST / PATCH / DELETE | `/v1/blocks[/:id]`                                                   | `block_create`, `block_update`, `block_delete`                                                                                     |
| POST                  | `/v1/mail/test`                                                      | —                                                                                                                                  |
| \*                    | `/v1/catalogs/*`, `/v1/geo/*`, `/v1/wizard/sites/*`                  | ya internos (proxy `php/ussitecreate_api.php`)                                                                                     |

**Eliminadas:** `PATCH /v1/reservations/:id`, `DELETE /v1/reservations/:id`.

### Proxy `web/php/booking_host_api.php`

- Sesión obligatoria: `$_SESSION['client']` (site) y `$_SESSION['user_id']` → si no, 401.
- `site_id`/`user_id` **siempre** de sesión; los ids de habitación/disponibilidad/bloqueo
  que vienen del cliente se verifican contra el site de sesión (404 si no pertenecen).
- CSRF: cabecera `X-CSRF-Token` = `$_SESSION['fsc_csrf']` (mismo token que el wizard;
  lo genera `bw_csrf_token()` en `inc/booking_wizard_lib.php`) en todo lo que no sea GET.
- Lista blanca de acciones con método fijo (405 si no coincide). Respuesta
  `{ok:true,data}` / `{ok:false,message}` con el status HTTP de la API.

---

## 3. Ciclo de vida del webhook

Tabla `stripe_webhook_events` (PK `stripe_event_id` = id único del evento de Stripe).

```
Stripe ──POST /v1/webhook──► verificar firma (400 si inválida)
   │
   ▼
1. CLAIM (tx corta)
   INSERT IGNORE (status=received) → SELECT … FOR UPDATE
   ├─ processed                         → 200 {duplicate}       (no se reprocesa)
   ├─ processing y lease < 5 min        → 409                    (Stripe reintenta)
   └─ received | failed | lease vencido → status=processing, attempts++
   ▼
2. PROCESS (una transacción)
   handler(evento, manager) + UPDATE status=processed, processed_at
   ├─ OK    → COMMIT → 3. emails (afterCommit) → 200
   └─ error → ROLLBACK → status=failed, last_error → 500 (Stripe reintenta;
              el reintento de un `failed` se reprocesa)
```

- **Concurrencia:** dos entregas simultáneas del mismo evento → el `INSERT IGNORE`
  - `FOR UPDATE` serializan; la segunda ve `processing` y recibe 409; su reintento
    posterior ve `processed` y se salta.
- **Crash a mitad:** la transacción de proceso hace rollback; el evento queda en
  `processing` y se retoma cuando vence el lease (5 min, `WEBHOOK_PROCESSING_LEASE_MS`).
- **Emails** solo después del commit: un rollback nunca deja un email de algo que no pasó,
  y un fallo de email no provoca que Stripe repita un cambio de dinero ya confirmado.

Eventos tratados:

| Evento                                                                   | Efecto                                                                                                                                                                             |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkout.session.completed`, `checkout.session.async_payment_succeeded` | `activateFromPayment` (ver §4)                                                                                                                                                     |
| `checkout.session.expired`, `checkout.session.async_payment_failed`      | expira la pendiente (idempotente, ignora si la sesión no es la actual)                                                                                                             |
| `charge.refunded`                                                        | `refunded` si `amount_refunded ≥ amount`, si no `partially_refunded`; guarda `amount_refunded`. Email solo si el reembolso no lo hizo nuestro flujo (p. ej. Dashboard).            |
| `charge.dispute.created`                                                 | crea disputa `source=stripe` (única por `stripe_dispute_id`), `payout_status=blocked` (si ya estaba `released`: evento `stripe_dispute_after_payout_released`)                     |
| `charge.dispute.closed`                                                  | `won`/`warning_closed` → `resolved_release`, desbloquea (`held`) si no hay otra disputa/reporte abierto; `lost` → `resolved_refund`, sigue `blocked`, evento `stripe_dispute_lost` |
| `transfer.created`                                                       | sincroniza `stripe_transfer_id` si un transfer se creó pero no se guardó                                                                                                           |
| `account.updated`                                                        | sincroniza `stripe_account_id` del anfitrión                                                                                                                                       |

**Configurar en Stripe Dashboard** (endpoint del webhook) estos eventos adicionales:
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
`charge.dispute.closed`.

---

## 4. Pago de una reserva (activación)

`ReservationService.activateFromPayment` (dentro de la transacción del webhook, fila bloqueada):

| Estado de la reserva                     | Resultado                                                                                                                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mismo `payment_intent` ya aplicado       | `already_active` (replay, nada)                                                                                                                                                          |
| ya pagada con **otro** `payment_intent`  | reembolso total del duplicado (`duplicate_payment`)                                                                                                                                      |
| importe distinto al esperado             | reembolso total (`amount_mismatch`), cancela y libera noches                                                                                                                             |
| `pending`                                | `activated` → confirmada, pagada, payout `held`                                                                                                                                          |
| `cancelled` (expirada) y noches libres   | `reactivated` → re-bloquea noches (FOR UPDATE) y confirma; evento `reactivated_after_expiry`                                                                                             |
| `cancelled` y noches ocupadas/bloqueadas | `refunded` (`payment_after_expiry_dates_unavailable`): reembolso total, `payment_status=refunded`, evento `payment_auto_refunded`, emails `payment_after_expiry_refund_guest` + `_admin` |

El cron de expiración (cada 10 s) aplica un margen de 2 min (`PENDING_EXPIRY_GRACE_MS`)
para no competir con un `checkout.session.completed` que llega tarde.

---

## 5. Idempotency keys y bloqueos

| Operación Stripe           | Key                                 | Extra                                                                                                                                                                |
| -------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkout.sessions.create` | `checkout:{reservationId}`          | `expires_at` = expiración de la reserva; `payment_intent_data.metadata.reservation_id` y `transfer_group`                                                            |
| `customers.create`         | `checkout-customer:{reservationId}` | solo si no existe cliente con ese email                                                                                                                              |
| `refunds.create`           | `refund:{reservationId}:{n}`        | `n = refund_seq + 1`, persistido en la misma transacción. Si Stripe reembolsa y el commit falla, el reintento usa el mismo `n` → Stripe devuelve el mismo reembolso. |
| `transfers.create`         | `transfer:{reservationId}`          | antes se busca `transfers.list({transfer_group: "reservation_{id}"})`; si existe se adopta (sirve también pasadas las 24 h de vida de la key)                        |
| `accounts.create`          | `express-account:{userId}`          |                                                                                                                                                                      |

Bloqueo de fila (`pessimistic_write` = `SELECT … FOR UPDATE`) sobre la reserva en:
cancelar (con/sin reembolso), reembolso independiente, liberar payout (cron y review),
finalizar, activación por pago, expiración, `charge.refunded`, disputas, `transfer.created`.

---

## 6. Variables de entorno

Sin variables nuevas obligatorias.

| Variable                              | Dónde   | Cambio                                                                                                                                                                                                          |
| ------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PENDING_RESERVATION_EXPIRATION_TIME` | booking | Default 15 min → **31 min** (1860000 ms). Valores < 31 min se elevan a 31 min (mínimo de Stripe + margen); máx. 24 h. Si tu `.env` fija 900000, ya no aplica: revisa y sube el valor. Añadida a `.env.example`. |
| `INTERNAL_API_KEY`                    | booking | Ya existía. Ahora protege también las rutas legacy.                                                                                                                                                             |
| `BOOKING_INTERNAL_KEY`                | web     | Ya existía (wizard). **Debe ser igual** a `INTERNAL_API_KEY`: sin ella el panel de reservas, Stripe Connect y la comprobación de checkout (`connect-status`) fallan.                                            |
| `BOOKING_INTERNAL_URL`                | web     | Ya existía. Recomendado en Docker (`http://host.docker.internal:3000`); si falta se usa `BOOKING_URL`.                                                                                                          |

---

## 7. Migración

`src/database/migrations/1791000000000-payments-f0-hardening.ts` (escrita a mano, con `down` completo):

- `stripe_webhook_events`: `status` enum, `attempts`, `last_error`, `processing_started_at`,
  `received_at`, `processed_at` pasa a NULL; filas existentes → `processed`; índice por `status`.
- `reservations`: `refund_seq` (int, default 0; 1 si ya tenía `stripe_refund_id`), `amount_refunded` decimal(10,2).
- `reservation_disputes`: `source` enum(`guest_report`,`stripe`), `stripe_dispute_id` (único), `stripe_status`, `closed_at`.

```bash
npm run migration:run      # aplicar
npm run migration:revert   # rollback de esta migración
```

---

## 8. Cómo probar a mano

### Preparación

```bash
# 1. Migración
npm run migration:run
# 2. Reenviar webhooks de Stripe (modo test) a la API local
stripe listen --forward-to localhost:3000/v1/webhook
#    copia el whsec_… que imprime en STRIPE_WEBHOOK_SECRET y reinicia la API
```

Tarjetas de test: `4242 4242 4242 4242` (OK), `4000 0000 0000 9995` (fondos insuficientes),
`4000 0000 0000 0259` (genera disputa → `charge.dispute.created`). Cualquier fecha futura y CVC.

### Guards

```bash
curl -i localhost:3000/v1/reservations/by-site/1/range?from=2026-01-01\&to=2026-12-31   # 401
curl -i -H "X-Internal-Key: $INTERNAL_API_KEY" "localhost:3000/v1/reservations/by-site/1/range?from=2026-01-01&to=2026-12-31"  # 200
curl -i -X PATCH localhost:3000/v1/reservations/1   # 404 (ruta eliminada)
curl -i localhost:3000/v1/reservations/1            # 404 sin session_id
```

### Flujos

1. **Checkout normal:** reservar en la ficha → pagar con 4242 → `reserva-exito` muestra
   la reserva confirmada. En BD: `stripe_webhook_events.status = processed`, `attempts = 1`.
2. **Reintento/idempotencia:** `stripe events resend evt_…` → respuesta `duplicate`, sin emails nuevos.
3. **Fallo y reintento:** parar la BD un momento y lanzar `stripe trigger checkout.session.completed`
   → evento `failed` con `last_error`, Stripe reintenta; al volver la BD pasa a `processed`.
4. **Expiración:** crear checkout y no pagar; `stripe checkout sessions expire cs_…`
   → reserva `cancelled` (`cancel_reason = checkout_session_expired`) y noches liberadas.
5. **Pago tras expiración:** abrir el checkout, forzar `expiration_date` pasada y esperar al cron
   (reserva cancelada); pagar en la pestaña aún abierta →
   noches libres ⇒ reserva `confirmed` + evento `reactivated_after_expiry`;
   noches ocupadas por otra reserva ⇒ reembolso total + evento `payment_auto_refunded` + email.
6. **Overbooking:** dos pestañas con la misma habitación/fechas → pulsar "Pagar" en ambas:
   una redirige a Stripe, la otra recibe 409 "Las fechas seleccionadas ya no están disponibles."
7. **Disputa:** pagar con `4000 0000 0000 0259` → `payout_status = blocked`, fila en
   `reservation_disputes` (`source = stripe`). Ganar/perder en Dashboard → `held` / sigue `blocked`.
8. **Cancelación con reembolso (panel anfitrión):** un solo email al huésped
   (`cancelled_guest_refund`); `charge.refunded` posterior no envía otro.

### Tests automáticos

```bash
npx vitest run --config vitest.config.unit.ts
```

Cubren: ciclo de vida/idempotencia/concurrencia del webhook, pago tras expiración (ambas ramas,
rollback con misma key), noches DST, cobertura de guards (lista pública exacta),
keys de refund/transfer y no reenvío de transfer, disputas (bloqueo/desbloqueo) y
`charge.refunded` parcial/total, overbooking con dos reservas en paralelo.

---

## 9. Rollback

1. `npm run migration:revert` (revierte solo `PaymentsF0Hardening1791000000000`).
2. Revertir el código de booking **y** de web a la vez: el JS nuevo llama al proxy
   `php/booking_host_api.php`, y el backend antiguo no tiene el endpoint de calendario
   público ni exige `session_id`.
3. Si solo se revierte el backend, el proxy sigue funcionando (reenvía con `X-Internal-Key`,
   que el backend antiguo ignora) salvo el calendario público del checkout
   (`/reservations/public/rooms/:id/calendar`), que daría 404.
4. Los eventos de webhook en `failed` al revertir se pierden como "procesables": revisarlos
   (`SELECT * FROM stripe_webhook_events WHERE status <> 'processed'`) antes de revertir.

---

## 10. Riesgos abiertos / fuera de alcance

- `checkout` acepta `user_id` del navegador (id del viajero logueado); solo se guarda en la
  reserva, no da acceso. Debería venir de la sesión PHP (fase siguiente).
- Sites legacy con `sites1.user_id = 0`: la propiedad se comprueba por email del perfil
  (igual que el login). No pueden cobrar (no hay anfitrión para el payout) hasta asignar `user_id`.
- Un reembolso total hecho desde el Dashboard de Stripe marca `payment_status=refunded`
  pero no cancela la reserva ni libera noches.
- `account.updated` escribe en `user_profiles` con su propio pool MySQL (fuera de la
  transacción del webhook); es idempotente.
- `quote` (público) consulta `accounts.retrieve` de Stripe en cada presupuesto (coste/rate limit).
- Los paneles `js/booking_rooms_dashboard.js` y `js/booking_reservations_dashboard.js`
  no se incluyen en ninguna página; se adaptaron al proxy (traductor de rutas) pero no se
  pueden probar en la UI actual.
