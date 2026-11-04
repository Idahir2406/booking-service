# Panel del viajero V1 — plan de desarrollo por fases

Plan de implementación derivado de [HANDOFF-panel-viajero-v1.md](HANDOFF-panel-viajero-v1.md), **contrastado contra el código real** (fecha de verificación: 2026-10-20). No implementa nada. Cada fase es ejecutable por un agente distinto, en orden.

Lectura previa obligatoria del agente que implemente: el handoff del panel, [HANDOFF-siguiente-agente.md](../payments/HANDOFF-siguiente-agente.md) y F0/F1/F2 en `booking/docs/payments/`. No se duplica lógica de cobro/refund: este plan **engancha** con `ReservationRefundService`, `ReservationPayoutService`, `ReservationEconomicsService`, `ReservationSnapshotService` y `ReservationFeedbackService`.

Reglas transversales (aplican a todas las fases):

- API Nest: rutas nuevas bajo `/v1`, **siempre** con `InternalApiKeyGuard`; el navegador nunca llama a la API, solo a proxies PHP. El `user_id` lo pone el proxy desde `$_SESSION['user_id']`, nunca el navegador.
- TypeScript: patrón const + tipo derivado (`as const`), interfaces planas, sin `any`, `import type`. Entidades en `snake_case`; updates con `preload()` + `save()`.
- PHP: compatible 5.6 (prod corre 8.3, pero la regla del repo es 5.6), patrón `xx/` wrapper + `php/*_body.php` con carga de `jvariables`, sin texto hardcodeado (fallbacks solo como `nrf_js_text`/`brl_text` hacen hoy). Escapar SQL con `real_escape_string` o `(int)`.
- CSS nuevo: `web/css/components/traveler_account.css`, cargado con `<link>` en el wrapper (igual que `xx/usprofile.php:11`). En producción el head carga `css/all.css` (bundle grunt `web/build/gruntfile_v4p.js`): **añadir el CSS al bundle** o mantener el `<link>` explícito en el wrapper.
- Migraciones: las ejecuta el usuario a mano (`npm run migration:run` en `booking/`). Ninguna fase ejecuta migraciones ni builds.
- Tests: `npx vitest run --config vitest.config.unit.ts` (los ejecuta el usuario o el agente si se le pide; no hacer build).

---

## 1. Resumen y discrepancias encontradas vs handoff

### 1.1 Resumen

El backend económico (checkout inmediato, cancelación de viajero, refunds, snapshot append-only, payouts) existe y es sólido. Lo que falta es **toda la capa de lectura del viajero**, el preview de cancelación, la biblioteca de perros, y los modelos de cambio / incidencia / alternativa. En la web ya existe una cuenta Club mínima (`/socperf`) que el handoff no menciona y que debe evolucionar al panel.

### 1.2 Confirmado (con evidencia)

| Afirmación del handoff                                                                                                                              | Evidencia                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cancel-traveler` existe, interno                                                                                                                   | `booking/src/contexts/reservations/api/reservation.controller.ts:124-131` (`@UseGuards(InternalApiKeyGuard)`)                                                                                                                                   |
| `cancelByTraveler`: ownership, pending sin refund, `force_majeure` → refund `pending` + dispute, dentro de plazo → refund total, fuera → sin refund | `services/reservation-refund.service.ts:112-280`, `assertTravelerAccess` `:81-88`, `openForceMajeureDispute` `:282-301`                                                                                                                         |
| Reembolso = importe cobrado entero                                                                                                                  | `utils/refund-policy.util.ts:54-59` (`resolveTravelerRefundAmountCents` → `expectedChargeCents`, `_snapshot` ignorado)                                                                                                                          |
| `buildRefundRule` = regla legacy 24 h, sin `cancellation`                                                                                           | `payments/domain/reservation-snapshot.ts:198-210` (`CURRENT_REFUND_RULE` `:13-14`)                                                                                                                                                              |
| `quoteCancellation` no se usa en producción                                                                                                         | firma `payments/domain/cancellation-policy.ts:221-289` (`CancellationQuoteInput` `:50-58`); único consumidor `tests/unit/contexts/payments/cancellation-policy.test.ts`                                                                         |
| Snapshot: `SnapshotDog`, `dog_policy`, `compatibility`, `deposit`, `refund_policy`                                                                  | `reservation-snapshot.ts:50-72` (refund rule + dog), `:83-129` (deposit, dog policy, compatibility), `:151-160` (extensión F2), `:162-178` (payload)                                                                                            |
| Entidades `reservation_snapshots`, `reservation_price_lines`, `payments`, `refunds`, `reservation_disputes`                                         | `payments/entities/reservation-snapshot.entity.ts` (único `reservation_id+version`), `reservation-price-line.entity.ts`, `payment.entity.ts`, `refund.entity.ts`, `reservations/entities/reservation-dispute.entity.ts`                         |
| `transitionPayout` existe y valida con máquina                                                                                                      | `payments/services/reservation-economics.service.ts:460-500`; `held↔blocked` permitido, `released` final (`payout-state-machine.ts:27-35`)                                                                                                      |
| `reservations.user_id` existe y lo fija checkout con `traveler_token` firmado                                                                       | `reservation.entity.ts:69-70` (`int NOT NULL`, 0 = invitado); `reservation.service.ts:661` `resolveTravelerUserId(dto.traveler_token)`, `:997`; PHP `web/components/reservation_book_wizard.php:48-49` + `web/inc/booking_checkout_lib.php:170` |
| Migración `1791100000000-charge-mode-immediate` existe                                                                                              | `booking/src/database/migrations/1791100000000-charge-mode-immediate.ts` — **es la última**; siguientes timestamps propuestos desde `1791200000000`                                                                                             |
| Guard + test de cobertura                                                                                                                           | `shared/guards/internal-api-key.guard.ts:39-50`; `tests/unit/contexts/shared/guard-coverage.test.ts:19-29` (lista pública cerrada), `:126-147` (rutas que deben ser internas)                                                                   |
| Proxy viajero: sesión `user_id`, CSRF `fsc_csrf`, `$allowed`                                                                                        | `web/php/booking_traveler_api.php:19-22`, `:29-39`, `:61-68`                                                                                                                                                                                    |
| `soclogin` fija `user_id`, `user_email`, `user_role`, `user_name`; no `client`                                                                      | `web/php/soclogin_verification.php:57-60`                                                                                                                                                                                                       |
| `socregister` inserta `role = customer`                                                                                                             | `web/php/socregister_verification.php:71`                                                                                                                                                                                                       |
| No existe tabla de perros del viajero                                                                                                               | Sin entidad en `booking/src/**/entities`; dump `web/admino/backup/2026-10-08 183948-backup-v4pdb.sql` solo tiene `dog_sizes`, `dog_supplies`, `site_dog_supplies`, `unit_pet_policies*`                                                         |

### 1.3 Discrepancias (lo que el handoff dice y el código desmiente o matiza)

| #    | Handoff                                                                                  | Realidad                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Impacto en el plan                                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | §5.2: catálogo con `change_of_plans`; "(ya existe)" para 5 motivos                       | El motivo genérico se llama **`voluntary`** (`refund-policy.util.ts:11`, `booking_traveler_api.php:62`, test `refund-policy.util.test.ts:10`). `reservations.cancel_reason` ya guarda `voluntary` en filas históricas                                                                                                                                                                                                                                              | Añadir los 8 códigos nuevos y **mantener `voluntary` aceptado** en API como alias legacy (no se muestra en UI). F-PV4                                                                          |
| D-2  | §5.3/§12: "cablear `quoteCancellation` cuando exista `refund_policy.cancellation`"       | **Nunca existe**: `buildRefundRule` no lo escribe y no hay tabla de políticas por tarifa (payments handoff §6, §7.1). Hoy toda reserva cae en la rama legacy 24 h                                                                                                                                                                                                                                                                                                  | La rama `quoteCancellation` se implementa y se testea con snapshots fixture; en producción no se ejercita hasta que exista la política por tarifa (proyecto aparte, fuera de alcance)          |
| D-3  | §5.3: preview separado del cancel                                                        | Si el preview usa `quoteCancellation` y `cancelByTraveler` sigue usando `expectedChargeCents`, **preview y ejecución divergen**                                                                                                                                                                                                                                                                                                                                    | F-PV4 extrae un resolvedor puro único usado por preview **y** por `cancelByTraveler` (payments handoff §7.1 punto 5)                                                                           |
| D-4  | §10: "botón que abre URL con token de feedback"                                          | El token se guarda **hasheado** (`reservation-feedback.service.ts:54-75`, `token_hash`); el raw solo viaja en el email de finalizar (`reservation-lifecycle.service.ts:150-171`). El panel **no puede recuperarlo**                                                                                                                                                                                                                                                | Nueva ruta interna que emite un token nuevo para el dueño (F-PV1). Ojo: enviar review **libera payout** y report **bloquea payout + abre dispute** (`reservation-feedback.service.ts:193-260`) |
| D-5  | §2.1: "No hay área mis reservas" (implícito: no hay cuenta viajero)                      | Existe **`web/xx/socprofile.php` → `php/socprofile_body.php`** (`/socperf`, `.htaccess:171`) con pestañas Info + Cambiar contraseña, jvariables `clublogin`+`cuenta`. El menú enlaza a customers allí (`inc/global_menu.php:277-278`). `php/socprofile_update.php` es código muerto (escribe en `jmarketing0`)                                                                                                                                                     | El panel **evoluciona `/socperf`**, no crea una cuenta paralela. Decisión D3                                                                                                                   |
| D-6  | §6.1: cambio de contraseña "patrón usprofile_chpwd"                                      | `socprofile_body.php` **ya usa** `php/usprofile_chpwd.php`, que **no valida CSRF ni la contraseña actual** (`usprofile_chpwd.php:19-45`)                                                                                                                                                                                                                                                                                                                           | El panel añade su propio endpoint con CSRF + contraseña actual (F-PV5)                                                                                                                         |
| D-7  | §4.5: guard "user_role === customer" igual que cancelación                               | El proxy actual **no comprueba rol** (`booking_traveler_api.php:19-22`); solo `user_id ≥ 1`. Además `soclogin` **rechaza** roles ≠ `customer` (`soclogin_verification.php:52`) y `juser_profiles.email` es **UNIQUE** (dump: `UNIQUE KEY ... (email)`), así que un anfitrión no puede tener cuenta Club con el mismo email. El checkout firma `traveler_token` para **cualquier** `user_id` de sesión, también el del anfitrión (`reservation_book_wizard.php:48`) | Reservas hechas por anfitriones logueados ya llevan su `user_id`. Decisión D2                                                                                                                  |
| D-8  | §4.5: proxy con acciones de lectura                                                      | El proxy solo acepta **POST** + JSON y **una** acción (`booking_traveler_api.php:25-27`, `:51-54`)                                                                                                                                                                                                                                                                                                                                                                 | Refactor a router con lista blanca, GET para lecturas, CSRF solo en no-GET (patrón `ussitecreate_photos.php:37-50`). F-PV2                                                                     |
| D-9  | §4.4: datos del alojamiento de `jsites1`/`jsites2` "con el mismo patrón que getSiteById" | `getSiteById` lee **solo `${DB_PREFIX}sites1`** con `SELECT *` (`reservation.service.ts:841-850`, `DB_PREFIX` default `v4p_j`). Fotos viven en `jsites2.image1..35` (`web/inc/booking_wizard_photos_lib.php:8-12`). `getSiteById` **lanza 404** si no existe                                                                                                                                                                                                       | Lectura en lote propia (`IN (...)`) de `sites1` (+ `image1`) sin lanzar; fallback al nombre de `snapshot.room`. F-PV1                                                                          |
| D-10 | §4.2: `GET /v1/reservations/by-traveler/:user_id` en el controlador de reservas          | `GET reservations/:id` es **público** con `ParseIntPipe` (`reservation.controller.ts:151-160`) y está en la lista pública del test; meter rutas nuevas bajo el mismo prefijo obliga a cuidar el orden de declaración                                                                                                                                                                                                                                               | Controlador nuevo con prefijo **`traveler`** y guard a nivel de clase. F-PV1                                                                                                                   |
| D-11 | §4.2: listar por `user_id`                                                               | **No hay índice** en `reservations.user_id` (solo `idx_reservations_site_room`, `reservation.entity.ts:43`; migración `1787545446222-first-migration.ts:20`)                                                                                                                                                                                                                                                                                                       | Migración de índice. F-PV1                                                                                                                                                                     |
| D-12 | §4.3: "Pago pendiente" para `pending`+`pending`                                          | Con cobro inmediato, cada checkout abandonado deja una fila `pending` hasta `expiration_date`. Mostrarlas ensucia el panel                                                                                                                                                                                                                                                                                                                                         | Excluir `pending` con `expiration_date < now` del listado. F-PV1                                                                                                                               |
| D-13 | §8.2: incidencia bloquea payout con `transitionPayout`                                   | `travelerPolicyAllowsCancel` **prohíbe cancelar** si `payout_status = blocked` (`refund-policy.util.ts:77-79`). Además el flujo "report" de feedback bloquea con `preload/save` directo, **no** con `transitionPayout` (`reservation-feedback.service.ts:223-244`)                                                                                                                                                                                                 | Abrir incidencia que bloquea ⇒ el botón Cancelar desaparece; documentarlo en UI. Usar `transitionPayout` (no copiar el atajo del feedback)                                                     |
| D-14 | §5 implícito: hay tests de cancelación                                                   | **No hay** test unitario de `cancelByTraveler` (solo `refund-policy.util.test.ts`, `economic-flows.test.ts` no lo cubre)                                                                                                                                                                                                                                                                                                                                           | F-PV4 añade tests del flujo                                                                                                                                                                    |
| D-15 | Snapshot "nuevo `version+1`" en cambios                                                  | `SNAPSHOT_REASON` solo tiene `checkout`, `manual_create`, `legacy_backfill` (`reservation-snapshot.entity.ts:9-13`); columna `reason varchar(64)` → añadir valor TS sin migración                                                                                                                                                                                                                                                                                  | F-PV7b                                                                                                                                                                                         |
| D-16 | —                                                                                        | Booking y legacy comparten **el mismo schema MySQL**: las migraciones de booking ya siembran `v4p_jvariables0/1` (`1790900000007-seed-steps5-7-variables.ts:143-177`) y crean FKs a tablas legacy (`fk_site_units_tipsite` → `v4p_jtipsite`). Excepción documentada: `site_settings.site_id` **sin FK** porque `jsites1` es de PHP (`1790716382883-new-form-tables.ts:13`)                                                                                         | Seeds de jvariables y columnas de perfil pueden ir en migraciones de booking. FK a `v4p_juser_profiles`: ver D1                                                                                |
| D-17 | §9: "Club 4Patas → xx/club4patas.php"                                                    | Existe (`.htaccess:95`, `xx/club4patas.php`, `php/pageClub4patas.php`)                                                                                                                                                                                                                                                                                                                                                                                             | Enlace directo; sin cambios                                                                                                                                                                    |
| D-18 | §9: "Ayuda → página ayuda general"                                                       | **No existe** página de ayuda; solo `contacto` (`.htaccess:88`)                                                                                                                                                                                                                                                                                                                                                                                                    | V1 enlaza a `contacto` (variable `cv_nav_help_link`); página de ayuda fuera de alcance                                                                                                         |

---

## 2. Decisiones abiertas (requieren producto / usuario)

Cada una con recomendación. El plan asume la recomendada; si se elige otra, se indica qué cambia.

### D1 — Almacenamiento de "Mis perros"

| Opción                                                                      | Pros                                                                                                               | Contras                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A)** Tabla legacy `v4p_jtraveler_dogs` + CRUD PHP                         | Todo en PHP, cero API                                                                                              | Lógica de talla (`deriveDogSize`, `pet-policies/domain/dog-compatibility.ts:176`) duplicada en PHP; sin tests vitest; el checkout (que vive en la API) no puede precargar perros sin otro salto |
| **B)** Tabla `traveler_dogs` en booking (TypeORM) + API interna + proxy PHP | Reutiliza `DOG_WEIGHT_LIMITS` y `deriveDogSize`; testeable; el quote/checkout podrá aceptar `dog_ids` en el futuro | Una ruta interna más por operación                                                                                                                                                              |

**Recomendación: B.** FK `user_id` → `v4p_juser_profiles(id)`: recomiendo **sin FK** (comentario de columna, igual que `site_settings.site_id`) porque la tabla es de PHP y un borrado manual de perfil no debe fallar por la API. La foto la guarda PHP (fichero) y la API solo guarda `photo_path`.

### D2 — Acceso del anfitrión como viajero

- Opción 1: solo `user_role = customer`. Un anfitrión que reservó logueado (su `user_id` ya está en `reservations`, D-7) no puede ver sus reservas nunca.
- Opción 2: permitir `user_role IN ('customer','host')` en el proxy del viajero; el anfitrión entra al panel desde su menú ("Mis viajes"), sin tocar `usprofile`.

**Recomendación: Opción 2.** La propiedad la garantiza la API (`reservation.user_id === user_id`). No se cambia `soclogin` (sigue solo customer). Coste: un enlace más en `inc/global_menu.php` para hosts.

### D3 — Punto de entrada del panel

- Opción 1: página nueva `xx/mi-cuenta.php` y dejar `/socperf` como está.
- Opción 2: **reemplazar el cuerpo de `/socperf`** por el panel (mismo wrapper `xx/socprofile.php`, nuevo `php/socprofile_body.php`) y añadir alias `RewriteRule ^mi-cuenta$ xx/socprofile.php`.

**Recomendación: Opción 2.** Una sola cuenta (es el objetivo del PDF); el menú ya apunta a `socperf`. Se conserva el cambio de contraseña dentro de la pestaña Perfil. `php/socprofile_update.php` (muerto) se deja sin tocar en V1 y se anota para limpieza.

### D4 — Incidencias: extender `reservation_disputes` o tabla nueva

- Extender disputes: añadir `type`, estados de UI… pero mezcla chargebacks de Stripe (`source = stripe`, `stripe_status`) con el ciclo de vida que ve el viajero, y sus estados (`open/resolved_release/resolved_refund`) son económicos, no de atención.
- Tabla nueva `reservation_incidents` (ciclo de UI: `received → in_review → needs_info → resolved`) con `dispute_id` opcional cuando la incidencia bloquea dinero.

**Recomendación: tabla nueva** + enlace a dispute. La cancelación `force_majeure` crea además una incidencia `type = force_majeure_cancellation` enlazada a su dispute, para que adjuntos y "Pendiente de revisión V4P" usen la misma UI.

### D5 — Dónde guardar adjuntos de incidencias / fuerza mayor

- En booking (multer + disco/S3): añade dependencia y almacenamiento nuevo a la API.
- **En PHP, fuera del docroot público** (`ROOT . '../v4p_private/incidents/{reservation_id}/'`, nombre aleatorio hex), con metadatos en `reservation_incident_attachments` vía API y descarga solo por proxy con verificación de propiedad.

**Recomendación: PHP privado.** Son documentos sensibles (certificados médicos); **no** usar `images/` ni `documents/` (son públicos, `inc/global_path.php:10-15`). Límite: 5 ficheros, 5 MB c/u (`FSCP_MAX_BYTES`), tipos `pdf, jpg, png, webp`. Requiere confirmar que Hostinger permite escribir fuera de `public_html`; si no, carpeta dentro con `.htaccess` `Require all denied` (patrón `web/docs/.htaccess`).

### D6 — Columnas extra de perfil

- Columnas nuevas nullable en `v4p_juser_profiles`: `surname`, `phone`, `avatar_path`, `updated_at`.
- Tabla `traveler_profiles` 1:1.

**Recomendación: columnas en `v4p_juser_profiles`** vía migración de booking (D-16 permite tocar legacy). Lectura/escritura del perfil 100 % PHP (tabla de PHP); la API no las necesita. Avatar en `images/jtraveler/` con nombre aleatorio (imagen no sensible).

### D7 — Qué tipos de incidencia bloquean el payout

**Recomendación:** bloquear (`held → blocked` con `transitionPayout`) solo para `during_stay`, `conditions_not_respected`, `dog_issue`, `charge_issue`, y solo si `payout_status = held`. No bloquear `before_arrival`, `refund_issue`, `other`. Si `released`, se registra auditoría `payout.transition_rejected` (A21 deuda, fuera de alcance). Producto debe confirmar la lista.

### D8 — Alcance de cambios con importe

- V1 mínimo: solicitud + estado + propuesta creada por V4P (ruta interna) + aceptar/rechazar **sin cargo extra** (delta ≤ 0; delta < 0 = refund con `refundInTransaction`).
- V1 completo: aceptar con cargo extra = nueva Checkout Session Stripe + webhook que confirme el cambio.

**Recomendación:** F-PV7b sin cargo extra; el cargo extra (F-PV7c) queda **condicionado** a confirmación de producto, porque toca webhook y ledger (`payments` admite varias filas `charge`, pero el webhook activa reservas, no cambios). Propuestas con delta > 0 se muestran "V4P te contactará para el pago" hasta F-PV7c.

### D9 — Quién crea propuestas y alternativas

**Recomendación:** solo V4P vía rutas internas (como `POST /v1/refunds/:id/review`, sin backoffice UI). El anfitrión no tiene UI en V1.

### D10 — Ventana de alerta "fin de cancelación gratuita"

**Recomendación:** 72 h antes del deadline (constante `FREE_CANCEL_ALERT_HOURS = 72` en util, no en UI).

---

## 3. Fases

Orden §11 del handoff. Estimación relativa: S (≤1 día), M (2-3 días), L (4+ días).

```
F-PV1 API lectura ─► F-PV2 Proxy ─► F-PV3 Shell + Mis reservas ─► F-PV4 Preview cancelación
                                             │                           │
                                             ├─► F-PV5 Perros + Perfil   │
                                             └─► F-PV6 Inicio ◄──────────┘ (usa resolvedor de F-PV4)
F-PV7a Incidencias (+adjuntos, fuerza mayor) ─► F-PV7b Cambios + alternativas ─► [F-PV7c cargo extra, condicionado D8]
```

---

### F-PV1 — API de lectura del viajero (list + detail + estados + token de valoración)

**Objetivo:** endpoints internos de solo lectura que devuelvan DTOs estables para la UI.
**Dependencias:** ninguna (migración `1791100000000` aplicada).
**Estimación:** M.

Tareas:

1. **Migración** `booking/src/database/migrations/1791200000000-reservations-user-index.ts` (clase `ReservationsUserIndex1791200000000`), escrita a mano e idempotente:
   - `up`: `CREATE INDEX idx_reservations_user_checkin ON reservations (user_id, checkin)` (comprobar existencia vía `information_schema.statistics` antes).
   - `down`: `DROP INDEX idx_reservations_user_checkin ON reservations`.
   - Añadir `@Index("idx_reservations_user_checkin", ["user_id", "checkin"])` en `reservations/entities/reservation.entity.ts`.
2. **Util de estado** `booking/src/contexts/reservations/utils/traveler-panel-status.util.ts`:

   ```ts
   export const TRAVELER_STATUS = {
     CANCELLED: "cancelled",
     INCIDENT_REVIEW: "incident_review",
     FINALIZED: "finalized",
     PAYMENT_PENDING: "payment_pending",
     CONFIRMED: "confirmed",
     IN_PROGRESS: "in_progress", // fallback conservador
   } as const;
   export type TravelerStatus =
     (typeof TRAVELER_STATUS)[keyof typeof TRAVELER_STATUS];

   export const TRAVELER_TAB = {
     UPCOMING: "upcoming",
     PAST: "past",
     CANCELLED: "cancelled",
   } as const;
   export type TravelerTab = (typeof TRAVELER_TAB)[keyof typeof TRAVELER_TAB];

   export interface TravelerStatusInput {
     reservation: Pick<ReservationEntity, "status" | "payment_status">;
     has_open_dispute: boolean;
     has_pending_refund: boolean;
     has_open_incident: boolean; // false hasta F-PV7a
   }
   export function mapTravelerFacingStatus(input: TravelerStatusInput): {
     status: TravelerStatus;
     is_fallback: boolean;
   };
   export function resolveTravelerTab(
     r: Pick<ReservationEntity, "status" | "checkout">,
     now: Date,
   ): TravelerTab;
   export function isAbandonedPendingCheckout(
     r: Pick<
       ReservationEntity,
       "status" | "payment_status" | "expiration_date"
     >,
     now: Date,
   ): boolean;
   ```

   Orden de evaluación exacto del handoff §4.3 (cancelled → incidencia/dispute open/refund pending → finalized → pending+pending → confirmed+paid → fallback con `Logger.warn`). Pestañas: `cancelled` = `status=cancelled`; `past` = `finalized` o `checkout < hoy` (UTC date); resto `upcoming`.

3. **DTOs de respuesta** `booking/src/contexts/reservations/dto/traveler-panel.dto.ts` (interfaces planas, sin anidar inline):
   - `TravelerReservationCardDto { id, code ("#RES-{id}"), site_id, site_name, site_image_url|null, room_name|null, checkin, checkout, nights, guests, dogs_count, status: TravelerStatus, tab, total_cents, currency }`.
   - `TravelerReservationListDto { items: TravelerReservationCardDto[], total, limit, offset }`.
   - `TravelerReservationDetailDto { card: TravelerReservationCardDto, stay: SnapshotStay, room: SnapshotRoom|null, board: SnapshotBoard|null, dogs: SnapshotDog[], dog_policy: SnapshotDogPolicy|null, compatibility: SnapshotCompatibility|null, deposit: SnapshotDeposit|null, services: SnapshotSelectedService[], extras: SnapshotSelectedExtra[], price_lines: TravelerPriceLineDto[], totals: PriceLinesSummary, policy: TravelerPolicyDto, payments: TravelerPaymentDto[], refunds: TravelerRefundDto[], capabilities: TravelerCapabilitiesDto, snapshot_version: number|null }`.
   - `TravelerPolicyDto { rule, refund_deadline_iso, timezone, generated_text|null, is_structured: boolean }`.
   - `TravelerPaymentDto { id, status_label_key, amount_cents, paid_at|null }` y `TravelerRefundDto { id, status_label_key, amount_cents, created_at, completed_at|null }` — **sin** `stripe_*` ni enums crudos: `status_label_key` es clave jvariables (`cv_pay_paid`, `cv_ref_pending`, `cv_ref_processing`, `cv_ref_completed`, `cv_ref_failed`…). Mapeo puro en el util del paso 2 (`mapPaymentLabelKey`, `mapRefundLabelKey`).
   - `TravelerCapabilitiesDto { can_cancel, can_review, can_request_change, can_report_incident }` (`can_cancel` = `travelerPolicyAllowsCancel`; `can_review` = `finalized` + sin `reservation_guest_feedback` + `feedback_deadline_at > now`; los otros dos `false` hasta F-PV7).
   - Fuente de datos del detalle: **siempre el snapshot** (`reservation.snapshot_version` → `findVersion`, fallback `findLatest`, mismo patrón que `ReservationRefundService.loadSnapshotPayload` `:99-110`). Si no hay snapshot (filas pre-F1): `price_lines` desde `reservation_price_lines` y resto `null`.
4. **Servicio** `booking/src/contexts/reservations/services/traveler-reservation-panel.service.ts` (solo lectura, sin transacciones):
   - `listForTraveler(userId: number, tab: TravelerTab, limit = 20, offset = 0): Promise<TravelerReservationListDto>` — query por `user_id` (rechaza `userId < 1` con 400), excluye `isAbandonedPendingCheckout`, orden `checkin ASC` en upcoming y `DESC` en past/cancelled.
   - `getDetailForTraveler(userId: number, reservationId: number): Promise<TravelerReservationDetailDto>` — 404 si no existe, **403** si `user_id` distinto (mismo mensaje que `assertTravelerAccess`).
   - Carga en lote: disputes `open` y refunds `pending` por `reservation_id IN (...)`; payments/refunds del detalle ordenados por `created_at`.
   - Sitios: método privado `loadSitesByIds(ids)` → `mysqlService.query` `SELECT s1.id, s1.name, s1.alias_l1, s1.poblacio, s1.provincia, s2.image1 FROM ${DB_PREFIX}sites1 s1 LEFT JOIN ${DB_PREFIX}sites2 s2 ON s2.id = (SELECT MIN(id) FROM ${DB_PREFIX}sites2 WHERE idback = s1.id) WHERE s1.id IN (?)`. No lanza si falta (fallback `snapshot.room.name`). URL de imagen la construye **PHP** (el DTO devuelve `site_image_file`), porque `$pathImage` vive en PHP (`inc/global_path.php:13`).
5. **Token de valoración** en `reservation-feedback.service.ts`: `issueTravelerFeedbackToken(userId, reservationId): Promise<{ token: string; expires_at: string }>` — verifica propiedad, `status = finalized`, sin feedback previo, `feedback_deadline_at > now`; reutiliza `createFeedbackToken(reservationId, feedback_deadline_at)`. 409 si ya valoró, 410 si venció.
6. **Controlador** `booking/src/contexts/reservations/api/traveler-panel.controller.ts`:
   ```ts
   @Controller({ path: "traveler", version: "1" })
   @UseGuards(InternalApiKeyGuard)
   export class TravelerPanelController {
     @Get(":user_id/reservations")            // ?tab=&limit=&offset= → TravelerReservationListQueryDto (IsIn tabs, IsInt Min/Max)
     @Get(":user_id/reservations/:id")
     @Post(":user_id/reservations/:id/feedback-token")
   }
   ```
   DTO de query: `booking/src/contexts/reservations/dto/traveler-reservation-list-query.dto.ts`.
7. **Registro** en `reservations/reservation.module.ts`: `controllers: [..., TravelerPanelController]`, `providers: [..., TravelerReservationPanelService]`, añadir `ReservationGuestFeedbackEntity` ya está; añadir `PaymentEntity` y `ReservationPriceLineEntity` a `TypeOrmModule.forFeature` (o usar `PriceLinesService.findByReservation` exportado por `PaymentsModule`).
8. **Guard coverage**: añadir a la lista "internas" de `tests/unit/contexts/shared/guard-coverage.test.ts:130-142`: `GET traveler/:user_id/reservations`, `GET traveler/:user_id/reservations/:id`, `POST traveler/:user_id/reservations/:id/feedback-token`. `PUBLIC_ROUTES` **no cambia**.

Tests vitest:

- `tests/unit/contexts/reservations/traveler-panel-status.util.test.ts`: (a) cancelled gana a dispute abierta; (b) dispute open + confirmed/paid → `incident_review`; (c) refund pending sin dispute → `incident_review`; (d) finalized; (e) pending+pending → `payment_pending`; (f) confirmed+paid → `confirmed`; (g) confirmed+`partially_refunded` → fallback `in_progress` con `is_fallback = true`; (h) tabs: checkout hoy = upcoming, ayer = past, finalized futuro = past; (i) `isAbandonedPendingCheckout` true/false por `expiration_date`; (j) mapeo de labels payments/refunds no expone `processing`/`pending_charge`.
- `tests/unit/contexts/reservations/traveler-reservation-panel.service.test.ts` (con `tests/utils/fake-entity-store.ts` + mock `MysqlService`): solo devuelve reservas del `user_id`; `user_id = 0` → 400; detalle de otro usuario → 403; detalle lee snapshot v1 aunque `reservation.total` cambie (regla "snapshot, no vivo"); sin snapshot → usa price lines; site inexistente no rompe.
- `reservation-feedback.service` test nuevo: emite token solo si finalized + sin feedback + no vencido; dueño distinto → 403.

Aceptación: los 4 criterios de §4.6 del handoff verificables vía API; guard-coverage verde.
Riesgos: N+1 en sitios (mitigado con lote); filas legacy sin snapshot.

#### Implementado en (2026-10-20)

Archivos nuevos:

- `booking/src/database/migrations/1791200000000-reservations-user-index.ts` (`ReservationsUserIndex1791200000000`, idempotente vía `information_schema.STATISTICS`). **Pendiente de ejecutar** por el usuario (`npm run migration:run`).
- `booking/src/contexts/reservations/utils/traveler-panel-status.util.ts` (`TRAVELER_STATUS`, `TRAVELER_TAB`, `TRAVELER_TABS`, `TRAVELER_PAYMENT_LABEL`, `TRAVELER_REFUND_LABEL`, `mapTravelerFacingStatus`, `resolveTravelerTab`, `isAbandonedPendingCheckout`, `mapPaymentLabelKey`, `mapRefundLabelKey`).
- `booking/src/contexts/reservations/dto/traveler-panel.dto.ts` (+ `TravelerFeedbackTokenDto`).
- `booking/src/contexts/reservations/dto/traveler-reservation-list-query.dto.ts` (`tab` default `upcoming`, `limit` 1–50 default 20, `offset` ≥ 0).
- `booking/src/contexts/reservations/services/traveler-reservation-panel.service.ts`.
- `booking/src/contexts/reservations/api/traveler-panel.controller.ts`.
- Tests: `booking/tests/unit/contexts/reservations/traveler-panel-status.util.test.ts`, `booking/tests/unit/contexts/reservations/traveler-reservation-panel.service.test.ts`, `booking/tests/unit/contexts/reservations/reservation-feedback-token.service.test.ts`.

Archivos modificados:

- `booking/src/contexts/reservations/entities/reservation.entity.ts` (`@Index("idx_reservations_user_checkin", ["user_id", "checkin"])`).
- `booking/src/contexts/reservations/services/reservation-feedback.service.ts` (`issueTravelerFeedbackToken`).
- `booking/src/contexts/reservations/reservation.module.ts` (controlador, servicio, `PaymentEntity` + `ReservationSnapshotEntity` en `forFeature`; price lines vía `PriceLinesService` exportado por `PaymentsModule`).
- `booking/tests/unit/contexts/shared/guard-coverage.test.ts` (3 rutas en la lista "internas"; `PUBLIC_ROUTES` sin cambios).

Rutas (todas `InternalApiKeyGuard` a nivel de clase): `GET /v1/traveler/:user_id/reservations?tab=&limit=&offset=`, `GET /v1/traveler/:user_id/reservations/:id`, `POST /v1/traveler/:user_id/reservations/:id/feedback-token`.

Ajustes respecto al texto del plan:

- Card: en lugar de `site_image_url` devuelve `site_image_file` (lo indicaba el paso 4; la URL la arma PHP en F-PV2) y añade `site_alias`, `site_town`, `site_province` (ya venían en la SELECT propuesta). `site_name` cae a `snapshot.room.name` si el sitio no existe o está vacío.
- El `Logger.warn` del fallback `in_progress` está en el servicio (al construir la card), no en el util, para que el util quede puro.
- Listado: filtro de pestaña + checkouts abandonados + orden + paginación en memoria sobre las filas del `user_id` (pocas por viajero; la pestaña depende de fecha y estado). Snapshots del listado en lote (`reservation_id IN (...)`) para `nights`, `total_cents` y `room_name`; los de la card del listado salen del snapshot congelado si existe, si no de `expectedChargeCents`.
- Labels: pagos `cv_pay_paid` / `cv_pay_pending` (method_validated, pending_charge, processing, pending_regularization) / `cv_pay_failed` (failed, definitive_unpaid); reembolsos `cv_ref_pending` (none, pending) / `cv_ref_processing` / `cv_ref_completed` (partial/total) / `cv_ref_failed`. Las claves jvariables se siembran en F-PV3.
- `issueTravelerFeedbackToken`: no finalizada → 400 (mismo criterio que `submitFeedback`); ya valoró → 409; sin `feedback_deadline_at` o vencido → 410. Cada llamada crea un token nuevo (los anteriores siguen válidos hasta el deadline).
- Fallo de la consulta legacy de sitios: se registra con `Logger.error` y la card sale con el fallback, no rompe el panel.

---

### F-PV2 — Proxy PHP del viajero (router + guard + lecturas)

**Objetivo:** convertir `web/php/booking_traveler_api.php` en router con lista blanca reutilizable por todas las fases.
**Dependencias:** F-PV1. **Estimación:** S.

Tareas:

1. Reescribir `web/php/booking_traveler_api.php` manteniendo `reservation_cancel_traveler` **idéntico en contrato**:
   - Guard: `$_SESSION['user_id'] ≥ 1` **y** `user_role ∈ array('customer','host')` (D2) → 401/403.
   - Métodos por acción: tabla `$bta_actions = array('reservations_list' => 'GET', 'reservation_detail' => 'GET', 'reservation_feedback_link' => 'POST', 'reservation_cancel_traveler' => 'POST')`; método distinto → 405.
   - CSRF (`X-CSRF-Token` = `$_SESSION['fsc_csrf']`, `hash_equals`) solo si método ≠ GET (patrón `ussitecreate_photos.php:37-50`).
   - JSON body solo en POST.
   - `reservations_list`: `?tab=upcoming|past|cancelled&page=` → `GET /traveler/{user}/reservations` (validar tab en whitelist; `limit=20`, `offset=(page-1)*20`). Añade `site_image_url` = `str_replace('{table}','jsites2',$pathImage) . site_image_file` (incluir `inc/global_path.php`).
   - `reservation_detail`: `?reservation_id=` → `GET /traveler/{user}/reservations/{id}`; mismo enriquecido de imagen.
   - `reservation_feedback_link`: body `{reservation_id}` → `POST .../feedback-token` → responde `{ok, data:{url: $hostIdLang.'reserva-feedback/'.token}}` (ruta `.htaccess:85`).
   - Respuestas `{ok:true,data}` / `{ok:false,message}`, igual que hoy (`:91-98`).
2. Extraer helper `bta_forward($method, $path, $query, $body)` para no repetir el bloque de `:85-98`.

Tests: manuales (no hay tests PHP en el repo): sin sesión → 401; host con sesión → 200; GET sin CSRF → 200; POST sin CSRF → 403; acción desconocida → 400; `reservation_id` de otro usuario → 403 propagado.
Aceptación: `reservation_cancel_traveler` sigue funcionando sin cambios en el JS existente.
Riesgo: el JS que hoy llama al proxy debe seguir mandando POST+JSON (no cambia).

#### Implementado en (2026-10-20)

Archivo reescrito: `web/php/booking_traveler_api.php` (único archivo tocado; sin seeds, sin cambios en `booking/`).

- Guard: `$_SESSION['user_id'] ≥ 1` → si no 401 `unauthorized`; `$_SESSION['user_role'] ∈ ('customer','host')` → si no 403 `forbidden`. Strings verificados: `socregister_verification.php:71` inserta `customer`, `usregister_sendMail.php:125,134` inserta `host`; ambos logins copian `juser_profiles.role` a `user_role` (`soclogin_verification.php:59`, `uslogin_verification.php:77`).
- Orden: sesión → rol → acción en `$bta_actions` (400 `invalid_action`) → método (405 + cabecera `Allow`) → CSRF solo si ≠ GET (403 `invalid_csrf`) → `session_write_close()` → includes (`global_connect`, `global_path`, `booking_wizard_lib`).
- Helpers (patrón `booking_host_api.php`): `bta_json_body`, `bta_pos_int`, `bta_require_id`, `bta_call` (devuelve data o termina con error), `bta_forward`, `bta_error_message`, `bta_with_image_url`, `bta_host_lang`.
- Acciones: `reservations_list` (GET, `tab` whitelist → 400 `tab_invalid`, `page` 1..10000 → 400 `page_invalid`, `limit=20`), `reservation_detail` (GET `reservation_id`), `reservation_feedback_link` (POST, devuelve `{url, expires_at}`), `reservation_cancel_traveler` (POST, contrato y lista de motivos iguales).
- Imagen: `site_image_url = str_replace('{table}','jsites2',$pathImage) . site_image_file` (null si vacío) en cada `items[]` y en `detail.card`.
- URL de valoración: `$hostId` + prefijo de idioma (`$_SESSION['langreal']`, español sin prefijo, igual que `$hostIdLang` de `xx/_init.php`) + `reserva-feedback/{rawurlencode(token)}`.

Ajustes respecto al texto del plan:

- Errores de la API **no se reenvían**: se traducen a códigos estables (`bad_request`, `forbidden`, `not_found`, `conflict`, `gone`, `validation_error`, `too_many_requests`) conservando 400/403/404/409/410/422/429; otro 4xx → 400; 5xx → 502 `booking_api_error`. **401 de la API → 502** (significa `X-Internal-Key` inválida, no sesión caducada; devolver 401 haría que la UI mandara al login). El texto original se escribe en `error_log`. Esto cambia el `message` de error de `reservation_cancel_traveler` (antes texto de la API); hoy ningún JS consume el proxy (`rg booking_traveler_api web/` solo lo encuentra a él mismo), así que no rompe nada. F-PV4 puede añadir códigos de negocio si la UI los necesita.
- `reservation_id` del cancel se valida con `bta_pos_int` (antes `(int)`): `"12abc"` ahora es 400 en vez de 12.

---

### F-PV3 — Shell de navegación (§9) + Mis reservas (listado + detalle + valorar + documentos §10)

**Objetivo:** cuenta única con menú lateral y pestaña de reservas en solo lectura.
**Dependencias:** F-PV2. **Estimación:** L.

Tareas:

1. **Migración seed** `booking/src/database/migrations/1791200000001-seed-cuenta-viajero-variables.ts` (patrón idéntico a `1790900000007-seed-steps5-7-variables.ts`: crea `v4p_jvariables0` página `cuenta_viajero` si no existe, inserta claves que falten, `down` borra solo esas claves). Claves (prefijo `cv_`):
   - Shell: `cv_titulo`, `cv_saludo` ("Hola, {name}"), `cv_nav_inicio`, `cv_nav_reservas`, `cv_nav_perros`, `cv_nav_club`, `cv_nav_perfil`, `cv_nav_ayuda`, `cv_nav_ayuda_link` (link → `contacto`), `cv_nav_club_link` (→ `club4patas`), `cv_nav_cerrar`, `cv_club_puntos_placeholder` ("Próximamente: puntos Club").
   - Listado: `cv_tab_proximas`, `cv_tab_pasadas`, `cv_tab_canceladas`, `cv_empty_proximas`, `cv_empty_pasadas`, `cv_empty_canceladas`, `cv_card_ver_detalle`, `cv_card_viajeros`, `cv_card_perros`, `cv_card_total`, `cv_cargar_mas`, `cv_error_carga`.
   - Estados: `cv_status_cancelled` (Cancelada), `cv_status_incident_review` (Incidencia en revisión), `cv_status_finalized` (Estancia finalizada), `cv_status_payment_pending` (Pago pendiente), `cv_status_confirmed` (Confirmada), `cv_status_in_progress` (En proceso).
   - Pagos/refunds: `cv_pay_paid`, `cv_pay_failed`, `cv_pay_pending`, `cv_ref_pending` (Pendiente de revisión V4P), `cv_ref_processing` (Reembolso en curso), `cv_ref_completed`, `cv_ref_failed`.
   - Detalle: `cv_det_volver`, `cv_det_estancia`, `cv_det_checkin`, `cv_det_checkout`, `cv_det_noches`, `cv_det_unidad`, `cv_det_regimen`, `cv_det_perros_declarados`, `cv_det_perro_ppp`, `cv_det_dogfriendly`, `cv_det_max_perros`, `cv_det_tallas`, `cv_det_solos`, `cv_det_zonas`, `cv_det_fianza`, `cv_det_fianza_info` (V4P no la cobra), `cv_det_desglose`, `cv_det_total`, `cv_det_politica`, `cv_det_deadline`, `cv_det_condiciones_aceptadas`, `cv_det_historial_pagos`, `cv_det_sin_movimientos`, `cv_det_valorar`, `cv_det_valorada`, `cv_det_valorar_vencida`.
   - Nota: los textos del motor (`generated_text`) se muestran tal cual (vienen del snapshot).
2. **Página** (D3): reescribir `web/php/socprofile_body.php` → shell con cabecera (avatar + `user_name`, menú desplegable PDF §2.1) y navegación lateral; `selTab` en `inicio|reservas|perros|club|perfil` (default `inicio`, whitelist). Carga jvariables `pagina IN ('clublogin','cuenta','cuenta_viajero')` (mantiene las claves actuales `socprofile_*`). Wrapper `web/xx/socprofile.php`: añadir guard (sin `user_id` o rol fuera de D2 → `header('Location: soclogi')`), `ob_start` como el skill, `<link>` a `css/components/traveler_account.css`. `.htaccess`: añadir `RewriteRule ^mi-cuenta$ xx/socprofile.php [NE,L]` junto a `:171`.
3. **Componentes** (uno por pestaña, incluidos desde el body): `web/components/traveler_reservations_tab.php` (contenedor + `window.__TRAVELER_ACCOUNT_CFG__` con `apiUrl`, `csrf => bw_csrf_token()`, `locale`, `texts` — patrón `usprofile_reservations_tab.php:115-139`). Pestañas Inicio/Perros/Perfil se crean vacías aquí y se rellenan en F-PV5/F-PV6. Club: enlace + placeholder sin puntos.
4. **JS**: `web/js/traveler_account.js` (cliente común: `taApi(action, {method, query, body})` con cabecera CSRF, manejo `{ok,message}`, formateo €/fechas con `Intl` y `locale`); `web/js/traveler_reservations.js` (tabs, paginación "cargar más", tarjetas, vista detalle en la misma pestaña con `history.pushState` `?selTab=reservas&res={id}`, botón Valorar → `reservation_feedback_link` → `location.href`). Sin estados crudos: solo `texts['cv_status_'+status]`.
5. **Menú**: `web/inc/global_menu.php:277-278` — enlace del customer apunta a `mi-cuenta`; añadir enlace "Mis viajes" para sesión host (D2) con variable `cambiarperfil_mis_viajes` (en página `menu`, seed en la misma migración).
6. **CSS**: `web/css/components/traveler_account.css` (tokens alineados con `us_profile_reservations.css`; responsive móvil con menú colapsable). Anotar en el PR que hay que añadirlo al bundle `all.css` para prod.

Tests: manuales (listado de §4.6, detalle = snapshot tras cambiar precio del site, valorar abre `/reserva-feedback/{token}` y tras enviar el botón pasa a "Valorada"). Vitest ya cubierto en F-PV1.
Aceptación: §4.6 completo; no aparece ningún enum backend en pantalla; reservas de invitado (`user_id=0`) no aparecen.
Riesgos: `socprofile_body.php` actual se pierde (mitigar: conservar el bloque de contraseña para F-PV5); CSS en prod.

#### Implementado en (2026-10-20)

Archivos nuevos:

- `booking/src/database/migrations/1791200000001-seed-cuenta-viajero-variables.ts` (`SeedCuentaViajeroVariables1791200000001`): página `cuenta_viajero` (85 claves `cv_*`) + `menu.cambiarperfil_mis_viajes`. Solo `description_l1` (la tabla no tiene más columnas de idioma; el resto va por `jclientes_translations`). `cv_nav_ayuda_link` → `link = contacto`, `cv_nav_club_link` → `link = club4patas`. **Pendiente de ejecutar** (`npm run migration:run`).
- `web/components/traveler_reservations_tab.php`, `traveler_home_tab.php`, `traveler_dogs_tab.php`, `traveler_club_tab.php`, `traveler_profile_tab.php`.
- `web/js/traveler_account.js` (`window.TravelerAccount`: `t`, `api`, `formatMoney`, `formatDate`, `formatDateTime`, `el`, `clear` + menú desplegable de cabecera), `web/js/traveler_reservations.js`.
- `web/css/components/traveler_account.css` (clases `.ta-*`, mobile-first, navegación lateral desde 993px).

Archivos modificados:

- `web/xx/socprofile.php`: `ob_start('v4p_ob_callback_replace_years')`, guard antes de emitir HTML (`user_id ≥ 1` y rol `customer|host`, si no `Location: soclogi`), `<link>` explícito al CSS con `filemtime`.
- `web/php/socprofile_body.php`: reescrito como shell; jvariables `clublogin`, `cuenta`, `cuenta_viajero`; `selTab` whitelist `inicio|reservas|perros|club|perfil` (enlaces antiguos `tab1`/`tab2` → `perfil`).
- `web/.htaccess`: `RewriteRule ^mi-cuenta$ xx/socprofile.php [NE,L]` junto a `socperf`.
- `web/inc/global_menu.php`: el botón del customer apunta a `mi-cuenta` (escritorio, y también en móvil, donde antes no había rama customer); botón "Mis viajes" (`cambiarperfil_mis_viajes`) para `user_role = host` en escritorio y móvil, solo si la variable existe.

Ajustes respecto al texto del plan:

- `window.__TRAVELER_ACCOUNT_CFG__` (`apiUrl`, `csrf`, `locale`, `tab`, `texts` = todas las `cv_*`) se emite en `socprofile_body.php` (común a todas las pestañas) y no en el componente de reservas; `traveler_account.js` se carga antes del contenido para que los scripts `defer` de cada pestaña lo encuentren.
- Claves extra a las listadas (necesarias para no mostrar enums ni texto fijo): `cv_nav_menu`, `cv_club_ver`, `cv_proximamente`, `cv_cargando`, `cv_card_noches`, `cv_card_noche_una`, `cv_det_sin_perros`, `cv_det_peso`, `cv_det_sin_limite`, `cv_det_tallas_todas`, `cv_det_ppp_admitidos`, `cv_det_solos_condicional`, `cv_det_si`, `cv_det_no`, `cv_det_zona_comer`, `cv_det_notas`, `cv_det_politica_legacy`, `cv_det_documentos`, `cv_det_pago`, `cv_det_reembolso`, `cv_det_valorar_no_disponible`, `cv_det_valorar_error`. Si falta una variable, PHP y JS muestran la clave (señal de seed pendiente) en lugar de un texto fijo.
- Valorar: el DTO solo expone `capabilities.can_review`, no distingue "ya valorada" de "plazo vencido". Con `finalized` y `can_review = false` se muestra `cv_det_valorar_no_disponible`; `cv_det_valorada` / `cv_det_valorar_vencida` se muestran cuando el proxy responde `conflict` (409) / `gone` (410) al pulsar. Para el texto exacto haría falta un campo `has_feedback` en el DTO (F-PV6 o posterior).
- Sin botón Cancelar en F-PV3: el plan lo coloca en F-PV4.6 (`capabilities.can_cancel` → motivo → preview → confirmar).
- Detalle: secciones Estancia, Perros declarados, Condiciones Dog Friendly (`left_alone` y `ppp_allowed` traducidos a Sí/No/Con condiciones; `compatibility.mode`, `return_mode`, `supplement_mode` no se muestran por ser enums), Fianza (solo si `required`), Desglose (`description` de cada línea), Política (deadline en la zona del snapshot, fallback `Europe/Madrid`) y Documentos ("Condiciones aceptadas" = `<details>` con `generated_text` tal cual o `cv_det_politica_legacy` si es null; historial de pagos/reembolsos con `status_label_key` whitelisted `cv_pay_*`/`cv_ref_*`).
- Perfil: conserva el bloque de datos + cambio de contraseña de `/socperf` (`php/usprofile_chpwd.php`, con sus textos de fuerza de contraseña inline originales) hasta F-PV5.
- Logout del panel: host → `logout`, customer → `soclogo`.
- CSS en prod: el `<link>` explícito en el wrapper basta; no se tocó `build/gruntfile_v4p.js` (el head actual no carga `all.css`).

---

### F-PV4 — Preview de cancelación + motivos PDF + modal

**Objetivo:** preview sin efectos que coincide al céntimo con la ejecución; 13 motivos.
**Dependencias:** F-PV3 (detalle). **Estimación:** M.

Tareas:

1. **Motivos** en `booking/src/contexts/reservations/utils/refund-policy.util.ts`:
   ```ts
   export const TRAVELER_CANCELLATION_REASON = {
     CHANGE_OF_PLANS: "change_of_plans",
     ILLNESS_PERSON: "illness_person",
     ILLNESS_PET: "illness_pet",
     DEATH_PERSON: "death_person",
     DEATH_PET: "death_pet",
     TRANSPORT: "transport",
     FINANCIAL: "financial",
     OTHER_ACCOMMODATION: "other_accommodation",
     BOOKING_ERROR: "booking_error",
     ACCOMMODATION_CONDITIONS: "accommodation_conditions",
     DOG_CONDITIONS: "dog_conditions",
     FORCE_MAJEURE: "force_majeure",
     OTHER: "other",
     VOLUNTARY: "voluntary", // legacy alias (D-1): aceptado por API, no ofrecido en UI
   } as const;
   export const TRAVELER_CANCELLATION_REASONS = Object.values(
     TRAVELER_CANCELLATION_REASON,
   );
   export const REASONS_REQUIRING_NOTES = [OTHER, FORCE_MAJEURE] as const;
   ```
   `TravelerCancelReservationDto`: validación condicional — `notes` obligatorio (`@ValidateIf`, `MinLength(10)`, `MaxLength(1000)`) para `other` y `force_majeure`.
2. **Resolvedor único** (D-3) en `refund-policy.util.ts`:

   ```ts
   export interface TravelerCancellationQuote {
     can_cancel: boolean;
     paid_cents: number;
     penalty_cents: number;
     refund_cents: number;
     within_free_period: boolean;
     deadline_iso: string | null;
     policy_text: string | null;
     releases_inventory: boolean;
     requires_review: boolean;
     source: "structured" | "legacy_24h";
   }
   export function resolveTravelerCancellationQuote(input: {
     reservation: ReservationEntity;
     snapshot: ReservationSnapshotPayload | null;
     reason: TravelerCancellationReason;
     now?: Date;
   }): TravelerCancellationQuote;
   export function firstNightCentsFromSnapshot(
     snapshot: ReservationSnapshotPayload,
   ): number;
   ```

   - `paid_cents` = `expectedChargeCents(reservation)` − ya reembolsado (`amount_refunded*100`).
   - `snapshot.refund_policy.cancellation` presente → `quoteCancellation({ policy, checkin, timezone: snapshot.timezone ?? reservation.timezone ?? "Europe/Madrid", paid_cents, first_night_cents, booked_at: reservation.created_at, now })`. `first_night_cents` = línea `accommodation` → `unit_amount_cents` (o `amount_cents / quantity`), `0` si no hay.
   - Ausente → legacy: dentro de `isWithinSnapshotRefundWindow` ⇒ refund = paid; fuera ⇒ 0; `policy_text = refund_policy.generated_text ?? null` (UI usa jvariable `cv_cancel_legacy_text`).
   - `force_majeure` → `requires_review = true`, `refund_cents` = paid (informativo, "solicitable tras revisión").
   - `pending` impagada → `paid_cents = 0`, `refund_cents = 0`, `can_cancel` según `travelerPolicyAllowsCancel`.
   - `releases_inventory = true` siempre que `can_cancel`.
   - `resolveTravelerRefundAmountCents` pasa a delegar en el resolvedor (`refund_cents`).

3. **`cancelByTraveler`** (`reservation-refund.service.ts:180-227`): usar el quote; si `refund_cents > 0` y no `force_majeure` → `refundInTransaction(manager, reservation, quote.refund_cents, ...)`; si `0` → sin refund. Rama `force_majeure` igual que hoy (pending con `refund_cents`). Guardar el quote en el evento `cancelled` (`penalty_cents`, `refund_cents`, `source`).
4. **Preview**: `TravelerPanelController` → `@Post(":user_id/reservations/:id/cancel-preview")` body `TravelerCancelPreviewDto { cancellation_reason }`; servicio `ReservationRefundService.previewTravelerCancellation(userId, id, reason)` (sin transacción, sin lock, sin Stripe, sin escritura). Ownership con `assertTravelerAccess`. Guard-coverage: añadir la ruta a la lista interna.
   - _Alternativa:_ `POST /v1/reservations/:id/cancel-traveler/preview` como sugiere el handoff. Se prefiere el prefijo `traveler` por D-10.
5. **Proxy**: acción `reservation_cancel_preview` (POST, CSRF) y ampliar `$allowed` de `reservation_cancel_traveler` con la misma lista (sin `voluntary` para la UI; aceptar `voluntary` solo por compatibilidad). Validar `notes` obligatorias para `other`/`force_majeure` también en PHP.
6. **UI** en `web/js/traveler_reservations.js`: botón Cancelar (si `capabilities.can_cancel`) → paso 1 motivo (select + textarea condicional) → `reservation_cancel_preview` → paso 2 modal con penalización / reembolso / deadline / texto política / aviso revisión → Confirmar → `reservation_cancel_traveler` → recarga detalle. El modal nunca dice "reembolso completado": tras cancelar muestra el estado del refund (`cv_ref_processing`/`cv_ref_pending`).
7. **Seed jvariables** `booking/src/database/migrations/1791200000002-seed-cancelacion-viajero-variables.ts` (página `cuenta_viajero`): `cv_cancel_btn`, `cv_cancel_titulo`, `cv_cancel_motivo`, `cv_cancel_reason_{código}` ×13, `cv_cancel_notas`, `cv_cancel_notas_obligatorias`, `cv_cancel_preview_pagado`, `cv_cancel_preview_penalizacion`, `cv_cancel_preview_reembolso`, `cv_cancel_preview_deadline`, `cv_cancel_preview_gratis`, `cv_cancel_preview_fuera_plazo`, `cv_cancel_legacy_text`, `cv_cancel_revision_v4p`, `cv_cancel_motivo_no_cambia` (el motivo no cambia el importe salvo circunstancia excepcional), `cv_cancel_confirmar`, `cv_cancel_volver`, `cv_cancel_ok`, `cv_cancel_error`, `cv_cancel_bloqueada_incidencia` (D-13).

Tests vitest:

- `refund-policy.util.test.ts` ampliado: catálogo de 14 códigos; `voluntary` sigue válido; `isTravelerCancellationReason("transport")`.
- `tests/unit/contexts/reservations/traveler-cancellation-quote.test.ts`: legacy dentro/fuera de plazo; structured `free_cancellation` 7 días dentro/fuera (deadline en `Europe/Madrid`, comparar con `freeCancellationDeadlineIso`); `partial_from_booking` 50 %; `first_night` usando línea accommodation; `non_refundable` → refund 0; `force_majeure` → `requires_review` y refund informativo; pending impagada → 0/0; reserva ya parcialmente reembolsada resta `amount_refunded`; `can_cancel=false` con `payout_status=blocked`.
- `tests/unit/contexts/reservations/reservation-refund.service.test.ts` (nuevo, D-14): preview y cancel devuelven el mismo `refund_cents` para el mismo snapshot/now; preview no llama a `save`, `refundInTransaction` ni Stripe; cancel structured fuera de plazo reembolsa `paid − penalty`; `force_majeure` crea refund pending + dispute; otro usuario → 403.
- DTO: `other` sin notas → error de validación.

Aceptación: checklist §12 "preview antes de cancel-traveler" y "quoteCancellation cableado" (rama structured cubierta por tests; legacy en prod).
Riesgos: cambiar `cancelByTraveler` toca dinero → sin la rama structured activa en prod el comportamiento es idéntico al actual (verificado por test de regresión legacy).

#### Implementado en (2026-10-21)

Archivos nuevos:

- `booking/src/contexts/reservations/dto/traveler-cancel-preview.dto.ts` (`TravelerCancelPreviewDto { cancellation_reason }`).
- `booking/src/database/migrations/1791200000002-seed-cancelacion-viajero-variables.ts` (`SeedCancelacionViajeroVariables1791200000002`, 38 claves `cv_cancel_*` en `cuenta_viajero`, solo `description_l1`). **Pendiente de ejecutar** (`npm run migration:run`).
- Tests: `booking/tests/unit/contexts/reservations/reservation-refund.service.test.ts` (9 de caracterización legacy escritos y en verde **antes** del refactor + 6 de preview + 2 de DTO), `booking/tests/unit/contexts/reservations/traveler-cancellation-quote.test.ts` (14).

Archivos modificados:

- `booking/src/contexts/reservations/utils/refund-policy.util.ts`: `TRAVELER_CANCELLATION_REASON` (13 + `voluntary`), `TRAVELER_CANCELLATION_REASONS`, `TRAVELER_CANCELLATION_UI_REASONS` (13), `REASONS_REQUIRING_NOTES`, `reasonRequiresNotes`, `CANCELLATION_QUOTE_SOURCE`, `TravelerCancellationQuote`, `resolveTravelerCancellationQuote`, `firstNightCentsFromSnapshot`; `resolveTravelerRefundAmountCents` delega en el resolvedor.
- `booking/src/contexts/reservations/dto/traveler-cancel-reservation.dto.ts`: notas 10–1000 obligatorias para `other`/`force_majeure` (constraint `CancellationNotesRequiredConstraint`); opcionales para el resto (`null` sigue aceptado).
- `booking/src/contexts/reservations/services/reservation-refund.service.ts`: `previewTravelerCancellation(userId, id, reason)` (sin transacción/lock/Stripe/escrituras); `cancelByTraveler` usa el quote (`refund_cents > 0` → `refundInTransaction(quote.refund_cents)`; `force_majeure` → pending con `quote.refund_cents` + dispute, igual que antes); el evento `cancelled` guarda `paid_cents`, `penalty_cents`, `refund_cents`, `quote_source`.
- `booking/src/contexts/reservations/api/traveler-panel.controller.ts`: `POST /v1/traveler/:user_id/reservations/:id/cancel-preview` (200).
- `booking/src/contexts/reservations/dto/traveler-panel.dto.ts`: `TravelerCancelPreviewResponseDto` (= quote + `reservation_id`, `cancellation_reason`, `currency`, `timezone`).
- `booking/tests/unit/contexts/shared/guard-coverage.test.ts` (ruta en la lista interna), `booking/tests/unit/contexts/reservations/refund-policy.util.test.ts` (catálogo 14/13, `other` ahora válido).
- `web/php/booking_traveler_api.php`: acción `reservation_cancel_preview` (POST + CSRF), helpers `bta_cancel_reason` (14 códigos) y `bta_cancel_notes` (400 `notes_required`).
- `web/js/traveler_reservations.js`: botón Cancelar (`capabilities.can_cancel`), aviso `cv_cancel_bloqueada_incidencia` si el estado es `incident_review`, modal en 2 pasos (motivo + notas → preview → confirmar), refresco del detalle.
- `web/css/components/traveler_account.css`: `.ta-cancel*`, `.ta-modal*`, `.ta-field*`.

Rama elegida: `snapshot.refund_policy.cancellation` presente → `quoteCancellation` (`source = structured`); ausente (todas las reservas hoy) → `legacy_24h` (reembolso = pagado dentro de `isWithinSnapshotRefundWindow`, 0 fuera).

Ajustes respecto al texto del plan:

- `paid_cents` = `expectedChargeCents − amount_refunded`. Para las reservas que se pueden cancelar (`payment_status = paid`) `amount_refunded` es 0/null (cualquier refund pasa el estado a `partially_refunded`/`refunded`), así que el importe legacy es idéntico al de antes; si alguna vez no lo fuera, ahora no se pide a Stripe más de lo que queda.
- Preview: `can_cancel` también es `false` si `payout_status = released` (cancelByTraveler lo rechaza con 400); el util puro no lo mira porque `travelerPolicyAllowsCancel` tampoco.
- `policy_text` = `refund_policy.generated_text` congelado; en structured, si falta, el texto de `quoteCancellation`; legacy → `null` (la UI usa `cv_cancel_legacy_text`).
- Pending impagada: `deadline_iso = null`, `within_free_period = true`, `requires_review = false` aunque el motivo sea `force_majeure` (cancelByTraveler no abre dispute en esa rama).
- Proxy: `reservation_cancel_traveler` ya **no reenvía la entidad** de la API (llevaba ids de Stripe); responde `{cancelled, refund_initiated, refund_pending_review}`. Ningún JS lo consumía antes de F-PV4.
- Claves extra a las listadas: `cv_cancel_motivo_placeholder`, `cv_cancel_ver_importes`, `cv_cancel_preview_reembolso_solicitable`, `cv_cancel_preview_sin_pago`, `cv_cancel_cerrar`, `cv_cancel_no_disponible`. Tras cancelar se muestra `cv_ref_processing` / `cv_ref_pending` (F-PV3), nunca "reembolso completado".

---

### F-PV5 — Mis perros + Mi perfil

**Objetivo:** biblioteca de perros reutilizable y perfil editable sin tocar snapshots.
**Dependencias:** F-PV3 (shell). **Estimación:** M.

Tareas (perros, D1 = B):

1. **Migración** `booking/src/database/migrations/1791300000000-traveler-dogs.ts`:
   ```sql
   CREATE TABLE IF NOT EXISTS traveler_dogs (
     id int NOT NULL AUTO_INCREMENT,
     user_id int NOT NULL COMMENT 'v4p_juser_profiles.id (no FK: legacy table owned by PHP)',
     name varchar(60) NOT NULL,
     weight_kg decimal(5,2) NOT NULL,
     is_ppp tinyint NOT NULL DEFAULT 0,
     photo_path varchar(255) NULL,
     created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
     updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
     deleted_at datetime(6) NULL,
     PRIMARY KEY (id),
     INDEX idx_traveler_dogs_user (user_id, deleted_at)
   ) ENGINE=InnoDB
   ```
2. **Contexto** nuevo `booking/src/contexts/traveler-dogs/`: `entities/traveler-dog.entity.ts` (`@DeleteDateColumn deleted_at`, `decimalTransformer`), `dto/traveler-dog.dto.ts` (`CreateTravelerDogDto { name: IsString 1..60; weight_kg: IsNumber maxDecimalPlaces 2, Min/Max DOG_WEIGHT_LIMITS; is_ppp: IsBoolean; photo_path?: IsString MaxLength 255 Matches /^images\/jtraveler\/[a-f0-9]{32}\.webp$/ }`, `UpdateTravelerDogDto` = `PartialType`), `services/traveler-dogs.service.ts` (`list(userId)`, `create(userId,dto)` máx `MAX_TRAVELER_DOGS = 10`, `update(userId,dogId,dto)`, `remove(userId,dogId)` soft delete; ownership → 404 si no es suyo, para no filtrar existencia), respuesta incluye `size` derivada con `deriveDogSize` y `DogSizeEntity`; `api/traveler-dogs.controller.ts` path `traveler`, guard de clase: `GET :user_id/dogs`, `POST :user_id/dogs`, `PATCH :user_id/dogs/:dog_id`, `DELETE :user_id/dogs/:dog_id`; `traveler-dogs.module.ts` registrado en `src/app.module.ts`.
   - Nota: dos controladores con prefijo `traveler` en módulos distintos es válido (rutas no colisionan).
3. **Guard coverage**: añadir las 4 rutas a la lista interna.
4. **Proxy**: acciones `dogs_list` (GET), `dog_create`, `dog_update`, `dog_delete` (POST), `dog_photo_upload` (POST multipart: valida MIME/5 MB, optimiza con `fph_postOptimizeImages` + `fph_resizeWebpBest` 600×600 de `inc/global_image_optimizing.php`, guarda `images/jtraveler/{bin2hex(random 16)}.webp`, borra la anterior, devuelve `photo_path` que el JS envía en `dog_update`). Multipart no es JSON: el proxy debe leer `$_FILES` en esa acción.
5. **UI** `web/components/traveler_dogs_tab.php` + `web/js/traveler_dogs.js`: lista con avatar, alta/edición en modal, borrar con confirmación, aviso fijo `cv_dogs_snapshot_aviso` ("Los cambios no afectan a reservas ya hechas").

Tareas (perfil, D6):

6. **Migración** `booking/src/database/migrations/1791300000001-juser-profiles-traveler-fields.ts`: `ALTER TABLE v4p_juser_profiles ADD COLUMN IF NOT EXISTS surname varchar(120) NULL, ADD COLUMN IF NOT EXISTS phone varchar(32) NULL, ADD COLUMN IF NOT EXISTS avatar_path varchar(255) NULL, ADD COLUMN IF NOT EXISTS updated_at datetime NULL`. `down` las elimina.
7. **Endpoint PHP** `web/php/traveler_profile_api.php` (JSON, mismo guard/CSRF que el proxy; **no** pasa por la API): `profile_get` (GET: `name, surname, email, phone, avatar_url` por `$_SESSION['user_id']`), `profile_update` (POST: `name` 1..80, `surname` ≤120, `phone` regex `^\+?[0-9 ]{6,20}$`; email solo lectura; actualiza `$_SESSION['user_name']`), `profile_password` (POST: `current_password` con `password_verify`, `new_password` = `confirm`, longitud ≥ 8, `password_hash(PASSWORD_BCRYPT)`), `avatar_upload` (como foto de perro, 400×400). Sin datos de tarjeta.
8. **UI** `web/components/traveler_profile_tab.php` + `web/js/traveler_profile.js` (reutiliza el medidor de fuerza actual de `socprofile_body.php`).
9. **Seed** `booking/src/database/migrations/1791300000002-seed-perros-perfil-variables.ts` (página `cuenta_viajero`): `cv_dogs_titulo`, `cv_dogs_empty`, `cv_dogs_add`, `cv_dogs_edit`, `cv_dogs_delete`, `cv_dogs_delete_confirm`, `cv_dogs_name`, `cv_dogs_weight`, `cv_dogs_ppp`, `cv_dogs_ppp_help`, `cv_dogs_photo`, `cv_dogs_size`, `cv_dogs_max`, `cv_dogs_snapshot_aviso`, `cv_dogs_saved`, `cv_dogs_error`, `cv_prof_titulo`, `cv_prof_name`, `cv_prof_surname`, `cv_prof_email`, `cv_prof_email_ro`, `cv_prof_phone`, `cv_prof_avatar`, `cv_prof_saved`, `cv_prof_error`, `cv_pwd_titulo`, `cv_pwd_actual`, `cv_pwd_nueva`, `cv_pwd_repetir`, `cv_pwd_ok`, `cv_pwd_error_actual`, `cv_pwd_error_igual`, `cv_pwd_error_longitud`, `cv_img_error_tipo`, `cv_img_error_size`.

Tests vitest `tests/unit/contexts/traveler-dogs/traveler-dogs.service.test.ts`: crea con talla derivada; peso fuera de límites rechazado por DTO; máximo 10; update/delete de perro ajeno → 404; soft delete no aparece en `list`; **editar un perro no modifica `reservation_snapshots`** (store fake: snapshot intacto).
Aceptación: perro editado no cambia el detalle de reservas pasadas; cambiar contraseña exige la actual.
Riesgos: escritura en tabla legacy (D6); limpieza de fotos huérfanas (se borra la anterior en cada subida).
Fuera de esta fase: precargar perros guardados en el wizard de checkout (siguiente iteración; el DTO de quote ya acepta `dogs[]`).

#### Implementado en (2026-10-21)

Archivos nuevos:

- Migraciones (**pendientes de ejecutar**, `npm run migration:run`): `booking/src/database/migrations/1791300000000-traveler-dogs.ts` (`TravelerDogs1791300000000`, `CREATE TABLE IF NOT EXISTS traveler_dogs`, sin FK), `1791300000001-juser-profiles-traveler-fields.ts` (`JuserProfilesTravelerFields1791300000001`: `surname`, `phone`, `avatar_path`, `updated_at` en `v4p_juser_profiles`), `1791300000002-seed-perros-perfil-variables.ts` (`SeedPerrosPerfilVariables1791300000002`, 67 claves `cv_dogs_*`, `cv_prof_*`, `cv_pwd_*`, `cv_img_*`, `cv_guardando` en `cuenta_viajero`, solo `description_l1`).
- Contexto `booking/src/contexts/traveler-dogs/`: `domain/traveler-dog.constants.ts` (`MAX_TRAVELER_DOGS = 10`, `TRAVELER_DOG_PHOTO_KEY_PATTERN`), `entities/traveler-dog.entity.ts`, `dto/traveler-dog.dto.ts` (`CreateTravelerDogDto`, `UpdateTravelerDogDto` = `PartialType`, `TravelerDogDto`, `TravelerDogListDto`), `services/traveler-dogs.service.ts`, `api/traveler-dogs.controller.ts`, `traveler-dogs.module.ts` (exporta `TravelerDogsService` para F-PV6).
- Test `booking/tests/unit/contexts/traveler-dogs/traveler-dogs.service.test.ts` (14).
- Web: `web/inc/traveler_media_lib.php` (fotos privadas), `web/php/traveler_profile_api.php`, `web/js/traveler_dogs.js`, `web/js/traveler_profile.js`.

Archivos modificados: `booking/src/app/app.module.ts` (`TravelerDogsModule`), `booking/tests/unit/contexts/shared/guard-coverage.test.ts` (4 rutas internas), `booking/tests/utils/fake-entity-store.ts` (`preload`), `web/php/booking_traveler_api.php`, `web/js/traveler_account.js` (`api()` admite `formData` y `endpoint`; `setCsrf`), `web/php/socprofile_body.php` (avatar en cabecera, `profileApiUrl` en la config), `web/components/traveler_dogs_tab.php`, `web/components/traveler_profile_tab.php`, `web/css/components/traveler_account.css`.

Rutas (guard de clase `InternalApiKeyGuard`): `GET /v1/traveler/:user_id/dogs` (`{items, max}`), `POST /v1/traveler/:user_id/dogs`, `PATCH /v1/traveler/:user_id/dogs/:dog_id`, `DELETE /v1/traveler/:user_id/dogs/:dog_id` (soft delete; devuelve el perro tal como estaba para que PHP borre su foto). Perro ajeno o borrado → 404. Talla = `deriveDogSize` + `normalizeDogSizes` sobre `dog_sizes` de la especie `DOG_SPECIES_NAME` (mismo origen que `ReservationQuoteContextService`). El servicio no tiene acceso a `reservations` ni a `reservation_snapshots` (test: el snapshot queda idéntico tras editar y borrar).

Proxy `booking_traveler_api.php`: `dogs_list` (GET), `dog_create` / `dog_update` / `dog_delete` / `dog_photo_delete` (POST JSON + CSRF), `dog_photo_upload` (POST multipart `dog_id` + `photo`, CSRF por cabecera), `dog_photo` (GET `dog_id`, sirve el fichero solo si el perro es del usuario de la sesión). Nuevo helper `bta_call_soft` (no termina la ejecución, para borrar el fichero si la API falla). Errores nuevos: `dog_name_invalid`, `dog_weight_invalid`, `dog_ppp_invalid`, `nothing_to_update`, `file_required`, `upload_failed`, `file_too_large` (413), `invalid_type` (415), `storage_not_writable`, `image_error`.

`traveler_profile_api.php` (100 % PHP, mismo guard/CSRF): `profile_get` (GET), `profile_update` (POST; actualiza `$_SESSION['user_name']`; email solo lectura), `profile_password` (POST), `avatar_upload` / `avatar_delete` (POST), `avatar` (GET, solo el propio).

Ajustes respecto al texto del plan:

- **Fotos privadas (D5 aplicado también a perros y avatar)**: no se usa `images/jtraveler/` (público). `inc/traveler_media_lib.php` guarda en `V4P_PRIVATE_DIR` si está definida, si no en `ROOT/../v4p_private/traveler/{dogs,avatars}/` (fuera de `public_html`) y, si no se puede escribir ahí, en `web/private_uploads/` con `.htaccess` `Require all denied` generado. `photo_path` / `avatar_path` guardan solo la clave `^[a-f0-9]{32}\.(webp|jpg)$` (DTO con `Matches`), nunca una ruta. Endurecimiento: `is_uploaded_file`, ≤ 5 MB, `finfo` (MIME por contenido) cruzado con `getimagesize`, solo jpeg/png/webp, máx. 40 MP, **re-codificación completa con GD** (recorte cuadrado 600 px perros / 400 px avatar, orientación EXIF, WebP o JPEG si no hay `imagewebp`), nombre `bin2hex(16 bytes aleatorios)`, `realpath` dentro de la carpeta al leer/borrar, respuesta con `nosniff` + CSP `sandbox` + `Cache-Control: private`.
- No se usa el optimizador remoto (`fph_postOptimizeImages`): la re-codificación local ya normaliza y evita enviar fotos privadas a otro servicio.
- La subida de foto recibe `dog_id` y hace ella misma el `PATCH photo_path` (en vez de devolver `photo_path` para que el JS lo mande en `dog_update`): el navegador nunca puede fijar `photo_path` (se ignora en `dog_create`/`dog_update`), así no puede apuntar a la foto de otro usuario. Perro nuevo: el JS crea y después sube.
- Migración de perfil: comprobación en `information_schema.COLUMNS` en lugar de `ADD COLUMN IF NOT EXISTS` (solo MariaDB lo soporta). Si aún no se ejecutó, `profile_get` devuelve los campos básicos con `extended = false` (la UI oculta apellidos/teléfono/avatar) y las escrituras responden 503 `profile_unavailable`.
- Contraseña: exige la actual. Formato real de la web: bcrypt (`password_hash(PASSWORD_BCRYPT)` en socregister/usregister/usprofile_chpwd) → `password_verify`; hashes legacy `encrypt_decrypt` (anfitriones antiguos, criterio de `uslogin_verification.php`) se verifican igual y quedan re-hasheados a bcrypt al cambiar. La master key de desarrollo **no** se acepta aquí. Hash vacío (anfitriones legacy sin contraseña) → no verificable (usar "olvidé mi contraseña"). Nueva: 8–72 bytes (límite bcrypt), letras y números, distinta de la actual. `UPDATE ... WHERE password = <hash leído>` (no pisa un cambio concurrente). Tras el cambio `session_regenerate_id(true)` + token CSRF nuevo devuelto al JS. Límite: 5 fallos de contraseña actual por sesión → bloqueo 15 min (429 `too_many_attempts`).
- `php/usprofile_chpwd.php` **no se toca**: el panel ya no lo usa, pero sigue siendo el endpoint del perfil del anfitrión (`php/usprofile_body.php`, `php/legacy/usprofile_body.php`) y sigue sin CSRF ni contraseña actual (deuda, fuera de esta fase; arreglarlo exige cambiar el formulario del anfitrión).
- Medidor de fuerza: mismo criterio que el bloque antiguo pero con textos `cv_pwd_fuerza_*` (el original los tenía fijos en JS).
- Claves extra a las listadas: `cv_guardando`, `cv_dogs_deleted`, `cv_dogs_weight_help`, `cv_dogs_kg`, `cv_dogs_ppp_tag`, `cv_dogs_photo_change`, `cv_dogs_photo_remove`, `cv_dogs_error_nombre`, `cv_dogs_error_peso`, `cv_dogs_guardar`, `cv_dogs_cancelar`, `cv_img_formatos`, `cv_prof_avatar_change`, `cv_prof_avatar_remove`, `cv_prof_avatar_saved`, `cv_prof_datos`, `cv_prof_phone_help`, `cv_prof_guardar`, `cv_prof_error_nombre`, `cv_prof_error_telefono`, `cv_pwd_desc`, `cv_pwd_requisitos`, `cv_pwd_mostrar`, `cv_pwd_guardar`, `cv_pwd_error`, `cv_pwd_error_debil`, `cv_pwd_error_distintas`, `cv_pwd_error_intentos`, `cv_pwd_fuerza_{debil,normal,fuerte,muy_fuerte}`.
- Límite de 10 perros: comprobación previa al insert (sin lock); dos altas simultáneas podrían dejar 11 (aceptado, no afecta a dinero).

---

### F-PV6 — Inicio y alertas (dashboard)

**Objetivo:** saludo, perros, próximo viaje y alertas en un round-trip.
**Dependencias:** F-PV1, F-PV4 (resolvedor), F-PV5 (perros). **Estimación:** S.

Tareas:

1. `booking/src/contexts/reservations/utils/traveler-alerts.util.ts`:
   ```ts
   export const TRAVELER_ALERT = {
     FREE_CANCEL_ENDING: "free_cancel_ending",
     INCIDENT_REVIEW: "incident_review",
     CHANGE_PROPOSAL_PENDING: "change_proposal_pending", // activo desde F-PV7b
     ALTERNATIVE_PENDING: "alternative_pending", // activo desde F-PV7b
   } as const;
   export const FREE_CANCEL_ALERT_HOURS = 72; // D10
   export function buildTravelerAlerts(
     input: TravelerAlertsInput,
     now: Date,
   ): TravelerAlertDto[];
   ```
   `FREE_CANCEL_ENDING` usa `deadline_iso` del resolvedor de F-PV4 (no de la ficha viva) y solo si `within_free_period` y `confirmed`. **Sin** alerta de deuda ni "actualizar método de pago".
2. `TravelerReservationPanelService.getDashboard(userId)` → `TravelerDashboardDto { next_trip: TravelerReservationCardDto | null, upcoming_count, dogs: TravelerDogSummaryDto[], alerts: TravelerAlertDto[] }` (`TravelerAlertDto { type, reservation_id, deadline_iso|null }`). Importa `TravelerDogsService` (exportado por su módulo).
3. Ruta `GET /v1/traveler/:user_id/dashboard` en `TravelerPanelController` + guard-coverage.
4. Proxy acción `dashboard` (GET).
5. UI `web/components/traveler_home_tab.php` + `web/js/traveler_home.js` (saludo con `user_name` de sesión, avatares de perros, tarjeta próximo viaje → detalle, alertas con enlace al detalle).
6. Seed `booking/src/database/migrations/1791300000003-seed-inicio-variables.ts`: `cv_home_saludo`, `cv_home_proximo`, `cv_home_sin_viajes`, `cv_home_buscar` (+ link), `cv_home_perros`, `cv_home_add_perro`, `cv_alert_free_cancel` ("Puedes cancelar gratis hasta {fecha}"), `cv_alert_incident`, `cv_alert_proposal`, `cv_alert_alternative`.

Tests `tests/unit/contexts/reservations/traveler-alerts.util.test.ts`: alerta a 71 h sí / 73 h no / deadline pasado no; reserva cancelada sin alertas; incidencia → alerta; nunca genera alertas de deuda.
Aceptación: §7 del handoff.

#### Implementado en (2026-10-21)

Archivos nuevos:

- `booking/src/contexts/reservations/utils/traveler-alerts.util.ts`: `TRAVELER_ALERT` (4 tipos), `FREE_CANCEL_ALERT_HOURS = 72`, `TravelerAlertCandidate`, `TravelerAlertDto`, `isFreeCancelEnding`, `isIncidentInReview`, `buildTravelerAlerts(input, now)` (pura: sin I/O ni reloj).
- `booking/src/database/migrations/1791300000003-seed-inicio-variables.ts` (`SeedInicioVariables1791300000003`, 18 claves `cv_home_*` / `cv_alert_*` en `cuenta_viajero`, solo `description_l1`; `cv_home_buscar` con `link = alojamientos-admiten-perros-destino/todos-los-destinos`). **Pendiente de ejecutar** (`npm run migration:run`).
- Test `booking/tests/unit/contexts/reservations/traveler-alerts.util.test.ts` (11).
- `web/js/traveler_home.js`.

Archivos modificados:

- `booking/src/contexts/reservations/services/traveler-reservation-panel.service.ts`: `getDashboard(userId, now = new Date())`; helpers compartidos con el listado (`loadVisibleRows`, `filterTab`, `mapStatus`, `reservationCode`, `NO_FLAGS`) para no duplicar filtro de abandonadas, orden ni mapeo de estado. Nuevo parámetro de constructor `TravelerDogsService`.
- `booking/src/contexts/reservations/api/traveler-panel.controller.ts`: `GET /v1/traveler/:user_id/dashboard`.
- `booking/src/contexts/reservations/dto/traveler-panel.dto.ts`: `TravelerDogSummaryDto`, `TravelerDashboardDto`.
- `booking/src/contexts/reservations/reservation.module.ts`: importa `TravelerDogsModule` (sin ciclo: dogs no importa reservas).
- `booking/tests/unit/contexts/shared/guard-coverage.test.ts` (ruta en la lista interna), `booking/tests/unit/contexts/reservations/traveler-reservation-panel.service.test.ts` (fixture con mock de perros + 5 tests de dashboard).
- `web/php/booking_traveler_api.php`: acción `dashboard` (GET, sin CSRF).
- `web/components/traveler_home_tab.php` (reescrito), `web/css/components/traveler_account.css` (`.ta-home*`, `.ta-alert*`, `.ta-link`).

Contrato: `TravelerDashboardDto { next_trip: TravelerReservationCardDto | null, upcoming_count, dogs: {id, name, photo_path, size}[], dogs_available, alerts: {type, reservation_id, code, site_name, deadline_iso}[] }`. El proxy añade `site_image_url` a `next_trip`, convierte `photo_path` en `photo_url` (`bta_dog_public`) y filtra `alerts` por lista blanca de tipos.

Reglas de alerta implementadas:

- `free_cancel_ending`: estado del viajero `confirmed` (confirmed + paid, sin dispute/refund pendiente), reserva en "Próximas", y el resolvedor de F-PV4 (`resolveTravelerCancellationQuote`, snapshot congelado; motivo `change_of_plans`, el motivo no cambia el plazo) da `can_cancel` y `within_free_period`; `0 < deadline − now ≤ 72 h`. `deadline_iso` = el del resolvedor.
- `incident_review`: estado `incident_review` (dispute `open` o refund `pending`, mismo util que la card) **o** reserva `cancelled` con refund `pending` (fuerza mayor esperando revisión de V4P).
- `change_proposal_pending` / `alternative_pending`: punto de extensión; el servicio pasa `false` hasta F-PV7b (sin datos falsos). Nunca para canceladas.
- Sin deuda ni "actualizar método de pago". Orden: fin de cancelación (deadline más cercano primero) → incidencias → propuestas → alternativas.

Ajustes respecto al texto del plan:

- Test "reserva cancelada sin alertas": se mantiene para canceladas sin revisión pendiente; una cancelación por fuerza mayor con refund `pending` **sí** genera `incident_review` (el handoff §7.1 pide avisar de "refund pending"; la card sigue mostrando `cancelled`, el orden del util no cambia).
- `TravelerAlertDto` añade `code` y `site_name` para que el aviso identifique la reserva sin otra llamada.
- `dogs_available`: si `TravelerDogsService.list` falla (p. ej. migración `1791300000000` sin ejecutar) el inicio no rompe: `dogs = []`, `dogs_available = false` (`Logger.error`) y la UI oculta el bloque.
- Saludo: `cv_home_saludo` con `user_name` de sesión (fallback email, igual que la cabecera), renderizado en PHP.
- Fecha del aviso: `TA.formatDateTime(deadline_iso)` en `Europe/Madrid` (el aviso no lleva la zona del snapshot; todos los alojamientos son de España).
- Claves extra a las listadas: `cv_home_intro`, `cv_home_proximas_total`, `cv_home_ver_reservas`, `cv_home_sin_perros`, `cv_home_ver_perros`, `cv_home_avisos`, `cv_alert_ver`, `cv_home_error`.

---

### F-PV7a — Incidencias ("Tengo un problema") + adjuntos + fuerza mayor

**Objetivo:** incidencias con adjuntos y estados de UI; bloqueo de payout por reserva.
**Dependencias:** F-PV3 (detalle), F-PV4 (fuerza mayor). **Estimación:** L.

Tareas:

1. **Migración** `booking/src/database/migrations/1791400000000-reservation-incidents.ts`:
   - `reservation_incidents`: `id int PK`, `reservation_id int NOT NULL` (FK `reservations(id)` ON DELETE RESTRICT), `user_id int NOT NULL`, `type enum('before_arrival','during_stay','dog_issue','conditions_not_respected','charge_issue','refund_issue','force_majeure_cancellation','other') NOT NULL`, `status enum('received','in_review','needs_info','resolved') NOT NULL DEFAULT 'received'`, `description text NOT NULL`, `dispute_id int NULL` (FK `reservation_disputes(id)` ON DELETE SET NULL), `blocks_payout tinyint NOT NULL DEFAULT 0`, `resolution_note text NULL`, `resolved_at datetime NULL`, `created_at/updated_at datetime(6)`; índices `idx_incidents_reservation (reservation_id, status)`, `idx_incidents_user (user_id, created_at)`.
   - `reservation_incident_attachments`: `id`, `incident_id` (FK CASCADE), `storage_key varchar(128) NOT NULL` (nombre aleatorio, sin ruta), `original_name varchar(255)`, `mime varchar(64)`, `size_bytes int`, `uploaded_by enum('traveler','admin')`, `created_at`; índice `idx_incident_attachments_incident`.
   - `reservation_incident_messages`: `id`, `incident_id` (FK CASCADE), `author_type enum('traveler','admin')`, `body text`, `created_at` (para "Necesitamos información" ↔ respuesta).
2. **Contexto** dentro de reservas: `entities/reservation-incident.entity.ts`, `reservation-incident-attachment.entity.ts`, `reservation-incident-message.entity.ts` (consts `INCIDENT_TYPE`, `INCIDENT_STATUS` con `as const`); `services/reservation-incident.service.ts`:
   - `createForTraveler(userId, reservationId, dto)` en transacción con lock: ownership; no `cancelled` salvo `refund_issue`; una incidencia abierta por tipo; si `type ∈ PAYOUT_BLOCKING_TYPES` (D7) y `payout_status = held` → `economics.transitionPayout(manager, reservation, "blocked", actors.traveler(userId), { onInvalid: ON_INVALID.IGNORE, metadata: { incident_id } })` (`ON_INVALID` en `payment-ledger.service.ts:39-44`; `IGNORE` audita `payout.transition_rejected` y no lanza) + crea `reservation_disputes` (`source guest_report`, `status open`) y enlaza `dispute_id`; evento `incident_opened`; email admin (nuevo `sendIncidentAdminEmail` en `reservation-email.service.ts`).
   - `addAttachment(userId, incidentId, meta)` (máx 5), `addTravelerMessage(userId, incidentId, body)` (si `needs_info` → pasa a `in_review`), `listForReservation(userId, reservationId)`.
   - Interno V4P: `updateStatus(incidentId, {status, note?})`; al `resolved` **no** libera payout automáticamente (la resolución económica sigue por `POST /v1/refunds/:id/review` o desbloqueo explícito `blocked → held` vía `transitionPayout` con flag `release_hold: boolean`).
   - `cancelByTraveler` rama `force_majeure`: crear también incidencia `force_majeure_cancellation` enlazada a la dispute de `openForceMajeureDispute` (estado `in_review`), sin bloquear payout adicional (la reserva ya queda cancelada y el refund pending).
3. **Rutas** en `TravelerPanelController`: `GET :user_id/reservations/:id/incidents`, `POST :user_id/reservations/:id/incidents` (`CreateIncidentDto { type: IsIn, description: 20..2000 }`), `POST :user_id/incidents/:incident_id/attachments` (`{ storage_key, original_name, mime, size_bytes }`, `storage_key` `Matches /^[a-f0-9]{32}\.(pdf|jpg|png|webp)$/`), `POST :user_id/incidents/:incident_id/messages`, `GET :user_id/incidents/:incident_id/attachments/:attachment_id` (devuelve metadatos para que PHP sirva el fichero). Controlador interno `api/incidents-admin.controller.ts` path `incidents`, guard de clase: `POST :incident_id/status`, `POST :incident_id/messages`. Todas a guard-coverage.
4. **Detalle**: `has_open_incident` real en `mapTravelerFacingStatus`; `capabilities.can_report_incident = status ∈ {confirmed, finalized}` y `checkout + 30 días > now`; DTO detalle añade `incidents: TravelerIncidentDto[]` (sin `admin_notes`).
5. **Proxy**: `incidents_list` (GET), `incident_create`, `incident_message` (POST JSON), `incident_attachment_upload` (POST multipart → guarda en ruta privada D5 `bta_private_dir()`, `finfo` para MIME real, 5 MB, nombre `bin2hex(openssl_random_pseudo_bytes(16)).ext`, luego registra en API; si la API falla, borra el fichero), `incident_attachment_download` (GET → pide metadatos a la API — ownership allí — y hace `readfile` con `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`). En el modal de cancelación `force_majeure` (F-PV4) se habilita el adjunto tras crear la cancelación (subida contra la incidencia devuelta en `CancelTravelerOutcome.incidentId`, campo nuevo).
6. **UI** `web/js/traveler_incidents.js` (bloque en el detalle: botón "Tengo un problema", tipos, descripción, adjuntos, hilo de mensajes, estados Recibida/En revisión/Necesitamos información/Resuelta).
7. **Seed** `booking/src/database/migrations/1791400000001-seed-incidencias-variables.ts`: `cv_inc_btn`, `cv_inc_titulo`, `cv_inc_type_{8 tipos}`, `cv_inc_desc`, `cv_inc_adjuntos`, `cv_inc_adjuntos_help`, `cv_inc_enviar`, `cv_inc_status_received`, `cv_inc_status_in_review`, `cv_inc_status_needs_info`, `cv_inc_status_resolved`, `cv_inc_responder`, `cv_inc_ok`, `cv_inc_error`, `cv_inc_ya_abierta`, `cv_inc_bloquea_cancelacion`, `cv_fm_pendiente_v4p`.

Tests `tests/unit/contexts/reservations/reservation-incident.service.test.ts`: ownership; `during_stay` con payout `held` → `blocked` vía `transitionPayout` + dispute enlazada + audit; `before_arrival` no bloquea; payout `released` → no cambia y audita `transition_rejected`; incidencia abierta duplicada → 409; máx 5 adjuntos; mensaje del viajero en `needs_info` → `in_review`; `force_majeure` en `cancelByTraveler` crea incidencia enlazada; status util devuelve `incident_review` con incidencia abierta.
Aceptación: §8.2 + §5.4 del handoff; los adjuntos no son accesibles por URL directa.
Riesgos: almacenamiento fuera de docroot en Hostinger (D5); bloqueo deja la reserva no cancelable (D-13, comunicado en UI).

#### Implementado en (2026-10-21)

Archivos nuevos:

- Migraciones (**pendientes de ejecutar**, `npm run migration:run`): `booking/src/database/migrations/1791400000000-reservation-incidents.ts` (`ReservationIncidents1791400000000`: `reservation_incidents` con FK `reservations` RESTRICT y `reservation_disputes` SET NULL + índice `idx_incidents_dispute`; `reservation_incident_attachments` con FK CASCADE y `UNIQUE uq_incident_attachments_storage_key`; `reservation_incident_messages` con FK CASCADE; todo `CREATE TABLE IF NOT EXISTS`), `1791400000001-seed-incidencias-variables.ts` (`SeedIncidenciasVariables1791400000001`, 52 claves: 50 `cv_inc_*` + `cv_fm_pendiente_v4p` + `cv_fm_adjuntar` en `cuenta_viajero`, solo `description_l1`).
- `booking/src/contexts/reservations/utils/reservation-incident.util.ts`: `INCIDENT_TYPE` (8), `TRAVELER_INCIDENT_TYPES` (7, sin `force_majeure_cancellation`), `PAYOUT_BLOCKING_INCIDENT_TYPES` (D7), `INCIDENT_STATUS`, `incidentStateMachine` (`received → in_review|needs_info|resolved`, `in_review → needs_info|resolved`, `needs_info → in_review|resolved`, `resolved` final), `INCIDENT_AUTHOR`, `INCIDENT_LIMITS`, `INCIDENT_ATTACHMENT_KEY_PATTERN`, `resolveReportableIncidentTypes` (regla pura que usan **a la vez** la validación del servicio y `capabilities`).
- Entidades `reservation-incident.entity.ts`, `reservation-incident-attachment.entity.ts`, `reservation-incident-message.entity.ts`; DTOs `dto/reservation-incident.dto.ts`.
- `services/reservation-incident.service.ts`, `api/incidents-admin.controller.ts`.
- Test `booking/tests/unit/contexts/reservations/reservation-incident.service.test.ts` (24).
- Web: `web/js/traveler_incidents.js`.

Archivos modificados: `reservation.module.ts`, `api/traveler-panel.controller.ts` (5 rutas), `services/reservation-refund.service.ts` (fuerza mayor → incidencia enlazada, `CancelTravelerOutcome.incidentId`), `services/traveler-reservation-panel.service.ts` (`has_open_incident` real, `capabilities.can_report_incident` + `reportable_incident_types`, `detail.incidents`), `dto/traveler-panel.dto.ts`, `utils/traveler-alerts.util.ts` (cancelada + incidencia abierta → `incident_review`), `utils/traveler-panel-status.util.ts` (comentario), email `incident_opened_admin` (`types/reservation-email.types.ts`, `reservation-email-template.service.ts`, `reservation-email.service.ts#sendIncidentAdminEmail`); tests `guard-coverage` (7 rutas internas), `reservation-refund.service.test.ts` (+2), `traveler-reservation-panel.service.test.ts` (+3 y expectativa de capabilities), `traveler-panel-status.util.test.ts` (+1), `traveler-alerts.util.test.ts` (+1); web `php/booking_traveler_api.php`, `inc/traveler_media_lib.php`, `js/traveler_reservations.js`, `components/traveler_reservations_tab.php`, `css/components/traveler_account.css`.

Rutas (guard de clase `InternalApiKeyGuard`): viajero `GET|POST /v1/traveler/:user_id/reservations/:id/incidents`, `POST /v1/traveler/:user_id/incidents/:incident_id/attachments`, `POST /v1/traveler/:user_id/incidents/:incident_id/messages`, `GET /v1/traveler/:user_id/incidents/:incident_id/attachments/:attachment_id`; V4P `POST /v1/incidents/:incident_id/status` (`{status, note?, release_hold?}`, 200) y `POST /v1/incidents/:incident_id/messages` (`{body}`).

Bloqueo / desbloqueo de payout (solo `ReservationEconomicsService.transitionPayout`, sin Stripe):

- Crear (transacción + `pessimistic_write` de la reserva): propiedad (403/404), máx. 10 incidencias por reserva (429), una abierta por tipo (409), tipos permitidos por `resolveReportableIncidentTypes` (400). Si el tipo es D7 (`during_stay`, `conditions_not_respected`, `dog_issue`, `charge_issue`): dispute `guest_report`/`open` (JSON `type=traveler_incident`) enlazada + `transitionPayout(→ blocked, traveler, onInvalid IGNORE, metadata incident_id)` si `payout_status` no es null. `held → blocked` CHANGED; `blocked` NOOP (idempotente); `released` → auditado `payout.transition_rejected` y sin cambio (`blocks_payout = false`). `before_arrival`, `refund_issue`, `other` no tocan payout ni crean dispute. Evento `incident_opened`; email admin tras commit (best effort).
- Desbloqueo (solo V4P): `status = resolved` + `release_hold = true` cierra la dispute de la incidencia (`resolved_release`) y hace `blocked → held` (actor admin, THROW) **solo si no queda ninguna dispute `open`** en la reserva (misma regla que `charge.dispute.closed` ganado); si queda otra → `still_blocked`. `resolved` sin `release_hold` no libera nada (resolución económica por `POST /v1/refunds/:id/review`). Repetir `resolved` + `release_hold` es idempotente y permite desbloquear después. El cron de payout ya solo libera `held`.

Ajustes respecto al texto del plan:

- Ownership: reserva ajena → 403 (mismo criterio que `assertTravelerAccess`); incidencia ajena → 403; incidencia/adjunto inexistente → 404.
- Tipo: el viajero solo puede abrir los 7 tipos del PDF; `force_majeure_cancellation` lo crea `cancelByTraveler` (estado `in_review`, `dispute_id` de `openForceMajeureDispute`, sin cambio de payout). Reserva `cancelled` (con dinero, `payment_status ≠ pending`) solo admite `refund_issue`; `pending` impagada nada; ventana `checkout + 30 días`.
- `capabilities.can_report_incident` usa `reservations.status` (confirmed/finalized/cancelled-con-pago) y no el estado del viajero: si no, una incidencia abierta (estado `incident_review`) impediría abrir otra de distinto tipo. Se añade `reportable_incident_types`.
- Mensajes y adjuntos del viajero se aceptan en cualquier estado abierto (la incidencia nueva se crea y luego se suben los ficheros; la de fuerza mayor está `in_review`); la UI muestra el formulario de respuesta solo en "Necesitamos información" (`can_reply`). Responder en `needs_info` → `in_review`. Resuelta → 409. Máx. 5 adjuntos (409), máx. 50 mensajes (429). Mismo `storage_key` dos veces = idempotente.
- `note` de V4P: en `needs_info`/`in_review` se guarda como mensaje visible al viajero; en `resolved` como `resolution_note`.
- No hay columna `admin_notes` en incidencias (las notas internas siguen en `reservation_disputes.admin_notes`).
- Una incidencia no bloqueante (p. ej. `before_arrival`) pone la tarjeta en "Incidencia en revisión" pero no oculta Cancelar (D7: solo el payout `blocked` impide cancelar, `travelerPolicyAllowsCancel`).
- Adjuntos (D5, `inc/traveler_media_lib.php` ampliada, tipo `incidents` → `…/v4p_private/traveler/incidents/`): `is_uploaded_file`, ≤ 5 MB, `finfo` (PDF o jpeg/png/webp cruzado con `getimagesize`), nombre `bin2hex(16 bytes)`, `realpath` dentro de la carpeta, clave validada con `TML_INCIDENT_KEY_REGEX`; imágenes **re-codificadas con GD sin recorte** (lado mayor ≤ 2000 px, WebP o JPEG); PDF con firma `%PDF-` y rechazo de `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/RichMedia`, `/XFA` (nombres `#xx` normalizados; no descomprime object streams). Descarga solo por `incident_attachment_download`: la API comprueba propiedad y devuelve la clave; PHP responde `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, CSP `sandbox`, `Cache-Control: private, no-store`, tipo por extensión de la clave. Si la API rechaza el alta del adjunto, PHP borra el fichero.
- Proxy: `incidents_list` (GET), `incident_create` / `incident_message` (POST JSON + CSRF), `incident_attachment_upload` (POST multipart `incident_id` + `file`, CSRF por cabecera), `incident_attachment_download` (GET). El navegador nunca recibe `storage_key` ni `dispute_id` (lista blanca `bta_incident_public`, `download_url` al proxy). `reservation_detail` devuelve `incidents[]` y `reservation_cancel_traveler` devuelve `incident_id` (fuerza mayor).
- UI: bloque "Tus incidencias" en el detalle (`js/traveler_incidents.js`, cargado antes que `traveler_reservations.js`), modal "Tengo un problema" (tipo + descripción + hasta 5 ficheros), hilo de mensajes, descargas, nota `cv_inc_bloquea_cancelacion` si bloquea el payout, `cv_fm_pendiente_v4p` en la de fuerza mayor; el modal de cancelación por fuerza mayor permite subir la documentación tras confirmar.
- Sin UI de backoffice (fuera de alcance, §6): V4P usa las 2 rutas internas con `X-Internal-Key`.

---

### F-PV7b — Solicitudes de cambio, propuestas y alternativas (sin cargo extra)

**Objetivo:** el viajero solicita cambios y acepta/rechaza propuestas y alternativas; la reserva original no cambia hasta aceptar.
**Dependencias:** F-PV7a (patrones), F-PV4. **Estimación:** L.

Tareas:

1. **Migración** `booking/src/database/migrations/1791400000002-reservation-changes-alternatives.ts`:
   - `reservation_change_requests`: `id`, `reservation_id` (FK RESTRICT), `user_id int`, `type enum('add_nights','change_dates','travelers','dogs','extras','other')`, `message text NULL`, `status enum('received','in_review','proposal_sent','accepted','rejected','cancelled') DEFAULT 'received'`, timestamps; índices `(reservation_id, status)`, `(user_id)`.
   - `reservation_change_proposals`: `id`, `request_id` (FK CASCADE), `before_payload json`, `after_payload json`, `amount_delta_cents int NOT NULL`, `status enum('pending_traveler','accepted','rejected','expired') DEFAULT 'pending_traveler'`, `expires_at datetime NOT NULL`, `resulting_snapshot_version int NULL`, timestamps; índice `(request_id, status)`.
   - `reservation_alternatives`: `id`, `reservation_id` (FK RESTRICT), `proposal_payload json` (site/room/fechas/precio), `status enum('pending_traveler','accepted','rejected','expired') DEFAULT 'pending_traveler'`, `expires_at`, `compatible_with_dogs tinyint NULL`, timestamps; índice `(reservation_id, status)`.
2. `SNAPSHOT_REASON` (`payments/entities/reservation-snapshot.entity.ts:9-13`): añadir `CHANGE_ACCEPTED: "change_accepted"` y `ALTERNATIVE_ACCEPTED: "alternative_accepted"` (sin migración, D-15).
3. `services/reservation-change.service.ts`:
   - Viajero: `createRequest` (solo `confirmed`+`paid`, `checkin > hoy`, una abierta por reserva), `list`, `cancelRequest`, `acceptProposal` (transacción + lock: `pending_traveler` y no vencida; delta > 0 → 409 `payment_required` hasta F-PV7c; delta < 0 → `refundInTransaction(|delta|)`; nuevo snapshot con `snapshots.createSnapshot` reason `change_accepted` = `after_payload` + nuevas `price_lines` vía `PriceLinesService.addLines` como `adjustment`; actualizar fechas/inventario con los métodos de `ReservationService` que ya liberan/toman noches — **verificar** al implementar que existe un "move" seguro; si no, limitar V1 a cambios sin cambio de fechas y documentarlo), `rejectProposal`.
   - Interno V4P: `createProposal(requestId, dto)` (`before_payload` = snapshot actual), `setRequestStatus`.
4. `services/reservation-alternative.service.ts`: interno `create(reservationId, dto)`; viajero `accept` (exige `compatible_with_dogs = true` comprobado con `snapshot.dogs` + `dog-compatibility.ts`; crea snapshot `alternative_accepted`), `reject`.
5. **Rutas** (`TravelerPanelController`): `GET/POST :user_id/reservations/:id/change-requests`, `POST :user_id/change-requests/:request_id/cancel`, `POST :user_id/change-proposals/:proposal_id/accept|reject`, `POST :user_id/alternatives/:alternative_id/accept|reject`. Internas: controlador `api/reservation-changes-admin.controller.ts` (`POST reservation-changes/:request_id/proposals`, `POST reservation-changes/:request_id/status`, `POST reservations/:id/alternatives` — **declarar en controlador con prefijo propio** `reservation-alternatives` para no tocar `reservations/:id`). Guard-coverage.
6. Detalle: `capabilities.can_request_change`, bloques `change_requests` y `alternatives`; alertas `CHANGE_PROPOSAL_PENDING` y `ALTERNATIVE_PENDING` activadas en `buildTravelerAlerts`.
7. Proxy: `change_request_create`, `change_request_cancel`, `change_proposal_accept`, `change_proposal_reject`, `alternative_accept`, `alternative_reject` (POST) y `change_requests_list` (GET).
8. UI `web/js/traveler_changes.js`: "¿Necesitas cambiar tu reserva?" (tipo + texto), tarjeta de propuesta antes/después + diferencia + Aceptar / Mantener actual; alternativa con aviso de compatibilidad de perros.
9. Seed `booking/src/database/migrations/1791400000003-seed-cambios-variables.ts`: `cv_chg_btn`, `cv_chg_titulo`, `cv_chg_type_{6}`, `cv_chg_mensaje`, `cv_chg_enviar`, `cv_chg_aviso_original` (la reserva no cambia hasta aceptar), `cv_chg_status_{6}`, `cv_chg_prop_titulo`, `cv_chg_prop_antes`, `cv_chg_prop_despues`, `cv_chg_prop_diferencia`, `cv_chg_prop_aceptar`, `cv_chg_prop_mantener`, `cv_chg_prop_pago_contacto` (D8), `cv_chg_prop_vencida`, `cv_alt_titulo`, `cv_alt_texto`, `cv_alt_aceptar`, `cv_alt_rechazar`, `cv_alt_incompatible`.

Tests `tests/unit/contexts/reservations/reservation-change.service.test.ts`: crear solicitud no modifica reserva ni snapshot; aceptar delta 0 crea snapshot `version+1` y **no** modifica el payload v1; delta < 0 llama a `refundInTransaction` con `|delta|`; delta > 0 → 409; propuesta vencida → 410; otro usuario → 403; alternativa incompatible con perros → 400; aceptar alternativa crea snapshot `alternative_accepted`.
Aceptación: §8.1/§8.3 del handoff con D8 mínimo.
Riesgos: movimiento de inventario en cambio de fechas (punto 3); concurrencia (locks pesimistas igual que `cancelByTraveler`).

#### Implementado en (2026-10-23)

Migraciones (**pendientes de ejecutar**, `npm run migration:run`; los timestamps del plan `1791400000002/3` ya estaban ocupados):

- `1791400000011-reservation-changes.ts` (`ReservationChanges1791400000011`): `reservation_change_requests` (+ `response_note`, `closed_at`), `reservation_change_proposals` (+ `reservation_id` desnormalizado con FK, `based_on_snapshot_version`, `conditions`, `message`, `close_reason`, `responded_at`), `reservation_alternatives` (+ `incident_id` FK SET NULL a `reservation_incidents`, `before_payload`, `amount_delta_cents`, `based_on_snapshot_version`, `resulting_snapshot_version`, `conditions`, `message`, `close_reason`, `responded_at`). `CREATE TABLE IF NOT EXISTS`, `down` solo lo suyo.
- `1791400000010-seed-panel-changes-variables.ts` (`SeedPanelChangesVariables1791400000010`): 87 claves `cv_chg_*` / `cv_alt_*` en `cuenta_viajero`, solo `description_l1`, sin emojis (el JS lleva fallback en español).

Backend (`booking/src/contexts/reservations/`):

- `utils/reservation-change.util.ts`: catálogos `CHANGE_REQUEST_TYPE` (6), `CHANGE_REQUEST_STATUS`, `CHANGE_OFFER_STATUS` (propuestas y alternativas), máquinas `changeRequestStateMachine` (`received → in_review|proposal_sent|rejected|cancelled`, `in_review → proposal_sent|rejected|cancelled`, `proposal_sent → in_review|accepted|rejected|cancelled`; finales `accepted/rejected/cancelled`) y `changeOfferStateMachine` (`pending_traveler → accepted|rejected|expired`), `CHANGE_LIMITS` (1 abierta por reserva, 10 en total → 429, mensaje 1000, caducidad por defecto 72 h, máx. 14 días y nunca después del check-in), `CHANGE_ERROR` (códigos estables), `isChangeEligibleReservation` (confirmed + paid/partially_refunded + check-in > hoy UTC), `effectiveOfferStatus`, `buildChangeQuoteInput`, `buildChangedSnapshotPayload`, `summarizeSnapshotForTraveler`.
- Entidades `reservation-change-request.entity.ts`, `reservation-change-proposal.entity.ts`, `reservation-alternative.entity.ts`; DTOs `dto/reservation-change.dto.ts`.
- `services/reservation-change-query.service.ts` (lectura: DTOs, `can_request_change`, flags de alertas; una oferta pendiente caducada se muestra `expired` sin escribir), `reservation-change-apply.service.ts` (motor común), `reservation-change.service.ts` (solicitudes + propuestas), `reservation-alternative.service.ts`.
- `ReservationService`: `quoteReservation(dto, { excludeReservation, skipHostPaymentCheck })` (las noches y la fila de la propia reserva no cuentan; sin lectura Stripe Connect; precios idénticos), `moveNightsForChange(manager, reservation, target)`, `loadSnapshotRoom` pasa a público. `SNAPSHOT_REASON.CHANGE_ACCEPTED` / `ALTERNATIVE_ACCEPTED` (D-15, sin migración).

Rutas (todas `InternalApiKeyGuard`, en guard-coverage): viajero `GET|POST /v1/traveler/:user_id/reservations/:id/change-requests`, `POST /v1/traveler/:user_id/change-requests/:request_id/cancel`, `POST /v1/traveler/:user_id/change-proposals/:proposal_id/accept|reject`, `POST /v1/traveler/:user_id/alternatives/:alternative_id/accept|reject`. V4P (D9, `api/reservation-changes-admin.controller.ts`): `GET /v1/reservation-changes?scope=open|all`, `GET /v1/reservation-changes/:request_id`, `POST /v1/reservation-changes/:request_id/status` (`in_review|rejected` + `note`), `POST /v1/reservation-changes/:request_id/quote` (simulación), `POST /v1/reservation-changes/:request_id/proposals`, `POST /v1/reservation-alternatives/:reservation_id/quote`, `POST /v1/reservation-alternatives/:reservation_id`.

Propuestas / alternativas: el precio SIEMPRE lo calcula el motor de checkout (`quoteReservation` con la reserva actual del snapshot + cambios de V4P; perros, servicios y extras se copian si no se envían; en alternativa los perros nunca se cambian). V4P solo puede añadir una línea `adjustment` explícita (`adjustment_cents`, ±10 000 €) p. ej. para dejar la diferencia en 0. `amount_delta_cents = after.total_cents − total del snapshot actual`. Se congelan `before_payload` (snapshot actual + nombre de alojamiento) y `after_payload`/`proposal_payload` (`target` de la reserva, `quote` exacto para revalidar, `snapshot` n+1 ya construido). Quote inválido → 422 (`dogs_incompatible` / `invalid_change`). Una nueva propuesta/alternativa caduca la anterior pendiente (`superseded`).

Aceptar (una sola transacción; locks `request → proposal → reservation` o `reservation → alternative`):

1. Propuesta pendiente y no vencida (vencida → se guarda `expired`, la solicitud vuelve a `in_review`, **410** `offer_expired`); solicitud abierta; reserva elegible (`not_eligible`); `reservation.snapshot_version === based_on_snapshot_version` (`offer_outdated`). Alternativa con `compatible_with_dogs ≠ true` → **400** `dogs_incompatible`.
2. D8: delta > 0 → **409** `payment_required`, nada cambia y la propuesta sigue pendiente (UI: "V4P te contactará para completar el pago"). Delta < 0 sin `stripe_payment_intent_id` o con payout `released` → 409 `refund_not_possible`.
3. Revalidación con el motor (disponibilidad, capacidad, compatibilidad de perros: nº, peso, PPP, condiciones Dog Friendly) sin repreciar → si falla, la oferta se guarda `expired` (`close_reason` = código) y **409** `unavailable`/`dogs_incompatible` (400 en alternativa por perros). La reserva no se toca.
4. `moveNightsForChange`: `SELECT … FOR UPDATE` de las filas `availability` de la estancia actual y de la nueva (un solo rango si es la misma unidad), re-chequeo tras el lock (bloqueos del anfitrión, filas que falten, noches ocupadas, reservas solapadas excluida la propia); las noches nuevas se bloquean como en `activateFromPayment`, las que ya tenía se mantienen y las que deja se liberan salvo que las cubra otra reserva. Conflicto → oferta `expired` (`unavailable`) + 409, sin escrituras.
5. `ReservationSnapshotService.createSnapshot` → versión n+1 con reason `change_accepted`/`alternative_accepted`, payload = snapshot congelado + `previous_version` + `change {kind, offer_id, request_id, amount_delta_cents, accepted_at}`. Las filas anteriores nunca se modifican (test). Política de cancelación congelada del booking se conserva (`cancellation`, `generated_text`); el plazo legacy se recalcula con el nuevo check-in. Comisión (`rate`, `cents`) la congelada de la reserva.
6. Reserva: `site_id`, `room_id`, `checkin`, `checkout`, `guests`, `pets`, `board_option_id`, `board_snapshot`, `extras_snapshot`, `snapshot_version`. **`total_cents` no cambia** (es lo cobrado): con delta < 0 la diferencia queda como reembolso (`amount_refunded`), así `expectedChargeCents − amount_refunded`, payout y preview de cancelación siguen cuadrando.
7. Price lines: delta ≠ 0 → una línea `adjustment` por la diferencia (`price_lines.change_adjustment`, metadata `offer_id`, `snapshot_version`). Delta 0 → sin líneas (el desglose completo de la nueva versión vive en el snapshot).
8. Delta < 0 → `ReservationPayoutService.refundInTransaction(manager, reservation, |delta|, "change_accepted:{kind}:{id}", {requestedBy: traveler, approvedBy: admin, responsible: traveler})` (plan D8; ruta de reembolso existente, idempotencia `refund:{id}:{n}`).
9. Auditoría: `reservation.change_applied` (antes/después), `snapshot.created`, `price_lines.change_adjustment`, `change_proposal.created|accepted|rejected|expired`, `alternative.created|accepted|rejected|expired`; eventos `change_*`/`alternative_*`.

Rechazar propuesta («Mantener mi reserva actual») → `rejected` y la solicitud pasa a `cancelled`. Retirar solicitud → `cancelled` + propuesta viva `rejected`. Alternativa «No aceptar» → `rejected`.

Panel: `capabilities.can_request_change` real; detalle con `change_requests[]` (estado efectivo: `proposal_sent` sin propuesta viva se muestra `in_review`), `alternatives[]`, `change_types[]`. Alertas F-PV6 `change_proposal_pending` / `alternative_pending` activas (oferta pendiente y no vencida en reservas próximas).

Web: `php/booking_traveler_api.php` acciones `change_requests_list` (GET), `change_request_create`, `change_request_cancel`, `change_proposal_accept`, `change_proposal_reject`, `alternative_accept`, `alternative_reject` (POST + CSRF, `user_id` de sesión), lista blanca de campos (`bta_change_*`) y códigos de negocio conservados (`bta_call_coded`); `reservation_detail` también filtra los bloques nuevos. `js/traveler_changes.js` (`window.TravelerChanges.renderBlock`): "¿Necesitas cambiar tu reserva?" → «Solicitar ayuda» (modal tipo + texto opcional + aviso "tu reserva sigue vigente"), solicitudes con estados Recibida/En revisión/Propuesta enviada/Aceptada/Rechazada/Cancelada, tarjeta de propuesta (tabla antes/después solo con divs, nuevo precio, diferencia, devolución, condiciones, plazo, «Aceptar cambio» deshabilitado con aviso de pago si delta > 0, «Mantener mi reserva actual», confirmación en línea) y de alternativa (diferencias + condiciones para perros antes/después + compatibilidad). `components/traveler_reservations_tab.php` carga el script; estilos `.ta-chg-*` en `css/components/traveler_account.css`.

Tests: `reservation-change.service.test.ts` (29, FakeReservationDb con transacciones/rollback e inventario reales), `reservation-change.util.test.ts` (8), `traveler-reservation-panel.service.test.ts` (+2 y `can_request_change`), guard-coverage (+14 rutas).

Pendiente / fuera de esta fase: emails (aviso a V4P de solicitud nueva, al anfitrión y al viajero de cambio aplicado), F-PV7c (cobro extra). La lectura Stripe Connect del anfitrión de una alternativa no se hace (V4P la verifica).

#### Corrección (2026-10-23): reembolso parcial por cambio aceptado

Antes, tras un cambio con delta < 0 la reserva quedaba `partially_refunded` y el viajero veía "En proceso" sin «Cancelar» (`traveler-panel-status.util.ts` solo mapeaba confirmed+paid; `travelerPolicyAllowsCancel` exigía `payment_status === "paid"`, que también bloqueaba `cancelByTraveler`).

- `utils/change-refund.util.ts`: `CHANGE_REFUND_REASON_PREFIX = "change_accepted:"` + `buildChangeRefundReason(kind, offerId)` (lo usa el apply service; `refunds.reason` es varchar(128), sin migración). `isPartiallyRefundedByChangeOnly`: confirmed + partially_refunded, ≥ 1 refund vivo (no `failed`), TODOS con reason de cambio y su suma = `amount_refunded`. Cualquier otro reembolso parcial (manual, excepcional, fuerza mayor pendiente, Stripe dashboard sin fila) mantiene "En proceso" y sin cancelar.
- Ese caso → estado «Confirmada»; `can_cancel` con la opción `partialRefundFromChange` (respeta payout `blocked`/`released`, incidencias, disputas); `can_report_incident` / `can_request_change` ya lo admitían.
- Dinero (misma función `resolveTravelerCancellationQuote` en preview y `cancelByTraveler`, que lee los refunds dentro de la transacción con la reserva bloqueada): base reembolsable = cobrado − ya reembolsado. Legacy 24 h: dentro → todo lo restante; fuera → 0. Estructurada: la penalización se calcula sobre el precio ACTUAL (`total_cents` del snapshot v2 y su primera noche), reembolso = min(precio actual − penalización, restante), `penalty_cents = restante − reembolso`. Fuerza mayor: importe solicitado = restante. Tras cancelar con reembolso del restante, `refundInTransaction` deja `payment_status = refunded` (transición existente).
- Tests: `change-refund.util.test.ts` (5), `reservation-refund.service.test.ts` (+6: preview = ejecutado dentro/fuera de ventana, estructurada, tope del restante, fuerza mayor, otros parciales bloquean), `traveler-reservation-panel.service.test.ts` (+3).

### F-PV7c — Aceptar cambio con cargo extra (condicionado a D8)

Solo si producto lo aprueba. Nueva Checkout Session (`StripeService`) con idempotencia `change:{proposal_id}`, fila `payments` adicional `charge`, webhook `checkout.session.completed` distingue `metadata.kind = change_proposal` y ejecuta `acceptProposal` al confirmar. Estimación L. No se detalla más hasta la decisión.

---

## 4. Matriz checklist §12 → fase/tarea

| Ítem §12                                                      | Cubierto en                                                                                                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Leído HANDOFF-siguiente-agente (no duplicar cobro/refund)     | Reglas transversales; F-PV4.3 reusa `refundInTransaction`; F-PV7a usa `transitionPayout`; F-PV7b reusa `refundInTransaction`/`createSnapshot` |
| Migración `1791100000000-charge-mode-immediate` aplicada      | §5 (prerrequisito, ya existe en repo)                                                                                                         |
| Panel usa soclogin (`customer`), no `usprofile`               | F-PV2.1 (guard), F-PV3.2 (vive en `/socperf`), D2 para hosts                                                                                  |
| Textos en `jvariables`                                        | Seeds `1791200000001`, `…0002`, `1791300000002`, `…0003`, `1791400000001`, `…0003`                                                            |
| Detalle lee snapshot, no política viva                        | F-PV1.3/1.4 + test "snapshot aunque cambie total"; F-PV6.1 alertas desde snapshot                                                             |
| Estados UI según §4.3                                         | F-PV1.2 util + tests; F-PV3.4 solo `cv_status_*`                                                                                              |
| Cancelación: preview antes de `cancel-traveler`               | F-PV4.4–4.6                                                                                                                                   |
| `quoteCancellation` cableado con `refund_policy.cancellation` | F-PV4.2–4.3 (rama structured + tests; D-2)                                                                                                    |
| Tests vitest mapeo de estados y preview                       | F-PV1 (`traveler-panel-status.util.test.ts`), F-PV4 (`traveler-cancellation-quote.test.ts`, `reservation-refund.service.test.ts`)             |
| No cobro diferido, deuda, liquidación semanal ni puntos Club  | §6; F-PV6 sin alerta de deuda; Club placeholder F-PV3.1                                                                                       |

Cobertura adicional: §9 navegación → F-PV3.2/3.5; §10 valorar → F-PV1.5 + F-PV2 + F-PV3.4; §10 documentos ("Condiciones aceptadas" + historial pagos/refunds) → F-PV1.3 + F-PV3.4.

---

## 5. Migraciones pendientes (las ejecuta el usuario)

En `booking/`: `npm run migration:run`. Orden:

| Timestamp     | Archivo                                 | Fase          | Qué hace                                                                                                    |
| ------------- | --------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------- |
| 1791100000000 | `charge-mode-immediate.ts`              | prerrequisito | Ya existe; aplicar si falta                                                                                 |
| 1791200000000 | `reservations-user-index.ts`            | F-PV1         | Índice `(user_id, checkin)`                                                                                 |
| 1791200000001 | `seed-cuenta-viajero-variables.ts`      | F-PV3         | Página jvariables `cuenta_viajero` + shell/listado/detalle + `menu.cambiarperfil_mis_viajes`                |
| 1791200000002 | `seed-cancelacion-viajero-variables.ts` | F-PV4         | Textos de cancelación y motivos                                                                             |
| 1791300000000 | `traveler-dogs.ts`                      | F-PV5         | Tabla `traveler_dogs`                                                                                       |
| 1791300000001 | `juser-profiles-traveler-fields.ts`     | F-PV5         | `surname`, `phone`, `avatar_path`, `updated_at` en `v4p_juser_profiles`                                     |
| 1791300000002 | `seed-perros-perfil-variables.ts`       | F-PV5         | Textos perros/perfil                                                                                        |
| 1791300000003 | `seed-inicio-variables.ts`              | F-PV6         | Textos inicio/alertas                                                                                       |
| 1791400000000 | `reservation-incidents.ts`              | F-PV7a        | `reservation_incidents`, `_attachments`, `_messages`                                                        |
| 1791400000001 | `seed-incidencias-variables.ts`         | F-PV7a        | Textos incidencias                                                                                          |
| 1791400000010 | `seed-panel-changes-variables.ts`       | F-PV7b        | Textos cambios/alternativas (el plan proponía `…0003`, ocupado)                                             |
| 1791400000011 | `reservation-changes.ts`                | F-PV7b        | `reservation_change_requests`, `_proposals`, `reservation_alternatives` (el plan proponía `…0002`, ocupado) |
| 1791400000012 | `seed-incidents-tab-variables.ts`       | §10           | Textos de la pestaña Incidencias (`cuenta_viajero` cv*inc_inbox*_/cv*inc_chat*_…, `menu.acct_incidencias`)  |

Todas escritas a mano, idempotentes (`IF NOT EXISTS` / comprobación previa), con `down` que solo revierte lo suyo. Además, en la web: carpeta privada de adjuntos (D5) creada con permisos de escritura y CSS añadido al bundle `all.css` de prod.

---

## 6. Fuera de alcance

- Cobro diferido (`charge_mode = flexible`), aviso "Actualizar método de pago", deuda del viajero, estados `method_validated`/`pending_regularization`/`definitive_unpaid`.
- Liquidación semanal, payouts por lote.
- Puntos Club 4Patas (generación y canje): solo hueco de menú.
- Email "Antes de viajar con tu perro".
- Política de cancelación por tarifa (persistencia, UI del alojamiento, copia al snapshot en checkout): proyecto propio (payments handoff §7.1). Este plan solo cablea la lectura.
- Vinculación de reservas de invitado (`user_id = 0`) por email.
- Backoffice UI de V4P para incidencias/propuestas (solo rutas internas).
- Página de Ayuda propia (V1 enlaza a `contacto`).
- Precarga de "Mis perros" en el wizard de checkout.
- Cargo extra en cambios (F-PV7c) hasta decisión D8.
- Limpieza de `web/php/socprofile_update.php` (código muerto sobre `jmarketing0`).

---

## 7. Unificación en usprofile (2026-10-22)

Petición: el panel del viajero se ubica en la misma página que el perfil del anfitrión (`web/xx/usprofile.php` + `web/php/usprofile_body.php`), mismo diseño, pestañas según el rol.

**URL única**: `/mi-perfil-textos` (y `/mi-perfil-fotos`) → `xx/usprofile.php`.

- Guard en `xx/usprofile.php` antes de emitir HTML: entra el anfitrión (`$_SESSION['client'] > 0`) o `user_id >= 1` con `user_role` `customer|host`; el resto → `Location: login`. (Antes no había guard: un anónimo provocaba avisos sobre `$_SESSION['client']`.)
- `$us_is_host = $_SESSION['client'] > 0`. Todo lo del anfitrión va bajo ese flag: consultas `jsites1/jsites2/site_settings/jtables/jemails0`, aviso de campos nuevos, acceso al wizard, paneles `tab1..tab8`, secciones Ventajas/Opciones/FAQs, los 3 bloques `<script>` del perfil y los CSS/JS del `<head>` (tinymce, combobox, stripe, reservas). Un customer no ejecuta ninguna consulta de anfitrión.
- jvariables: `A.pagina IN ('cuenta', 'cuenta_viajero')` (las `cv_*` también pasan por la traducción `jclientes_translations`).

**Pestañas (`selTab`, whitelist por rol; claves `tv_*` no colisionan con `tabN`)**

| Rol                               | Pestañas                                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| customer (o host sin alojamiento) | `tv_inicio` (por defecto), `tv_reservas`, `tv_perros`, `tv_club`, `tv_perfil`, + enlaces Ayuda (`cv_nav_ayuda_link` o `contacto`) y Cerrar sesión (`soclogo`; `logout` si rol host)   |
| anfitrión                         | `tab1..tab8` sin cambios (por defecto `tab1`) + `tv_reservas` ("Mis viajes", texto `cambiarperfil_mis_viajes` del menú; si falta `cv_nav_reservas`) + `tv_perros`, y su Cerrar sesión |

- El anfitrión **no** tiene `tv_inicio`/`tv_club`/`tv_perfil`: conserva su `tab2` (alojamiento) y `tab7` (contraseña); `?selTab=tv_perfil` → `tab7` (nunca dos formularios de contraseña).
- Anfitrión legacy sin `user_id`: sin pestañas `tv_*` (los proxies las rechazarían).
- Deep-links: `?selTab=tv_reservas&res={id}&rtab=past` (js/traveler*reservations.js `buildUrl`, js/traveler_home.js, enlaces de components/traveler_home_tab.php). Al cambiar a/desde una pestaña `tv*\*`un listener hace`history.replaceState`con`?selTab=<id>`; entre pestañas del anfitrión la URL no se toca (como antes).

**Diseño**: paneles `tv_*` dentro del marcado de pestañas Materialize del perfil (`.zzCuenta_Tabs_Opcion ul.tabs li.tab`, `div#tv_* .col.s12`, cabecera `h2.zzCuenta_Tabs_Name` con avatar + nombre para el viajero; banner con `cv_titulo` + `cv_saludo`). Cada componente va envuelto en `.ta-account.ta-account--embedded`. Se eliminó la cabecera/menú desplegable y la navegación lateral del viajero (HTML, CSS `.ta-header/.ta-menu/.ta-nav/.ta-layout/.ta-title`, `initMenu()` en traveler_account.js). Títulos `.ta-panel-title` en Caveat 30px #385b50 (= `.zzCuenta_Tab_Perfil_Titulo`). Todos los paneles están en el DOM (cambio de pestaña sin recarga); cada script se inicializa una vez.

**Config JS**: `window.__TRAVELER_ACCOUNT_CFG__` (apiUrl, profileApiUrl, csrf, locale, tab, accountUrl, texts `cv_*`) y `js/traveler_account.js` se emiten una vez en `usprofile_body.php`, solo si el rol tiene pestañas `tv_*`; cada componente carga su script (`defer`, `filemtime`).

**Rutas**: `/socperf` y `/mi-cuenta` siguen apuntando a `xx/socprofile.php`, que ahora solo hace guard (→ `soclogi`) y `302` a `mi-perfil-textos` mapeando `selTab` (`inicio|reservas|perros|club|perfil` → `tv_*`, `tab1/tab2` → `tv_perfil`) y conservando `res`/`rtab` validados. `php/socprofile_body.php` queda vacío (obsoleto). `production-htaccess` gana la regla `mi-cuenta`. `inc/global_menu.php`: customer → `mi-perfil-textos`; anfitrión "Mis viajes" → `mi-perfil-textos?selTab=tv_reservas`.

**CSS**: `css/components/traveler_account.css` se sigue cargando con `<link>` + `filemtime` desde `xx/usprofile.php` (el bundle `css/all.css` de prod no lo incluye).

**Proxies sin cambios**: `php/booking_traveler_api.php`, `php/traveler_profile_api.php`.

**Probar a mano**: perfil del anfitrión idéntico (tab1..tab8, guardar perfil, fotos, Stripe, reservas, contraseña, aviso de campos nuevos); anfitrión → Mis viajes / Mis perros; customer → 5 pestañas + detalle `res`, cancelar, incidencias, perros, avatar, contraseña; `/socperf?selTab=tab2`, `/mi-cuenta?selTab=reservas&res=N`; anónimo en `/mi-perfil-textos` → `login`.

## 8. Huecos pequeños (2026-10-23)

- **§5.1 Dirección**: `detail.site_address` (string|null) compuesta por `composeSiteAddress` (`utils/traveler-detail.util.ts`) con los datos que ya lee `loadSitesByIds` (fallo → null, nunca rompe el detalle). `v4p_jsites1` **no tiene calle ni CP** (solo `poblacio`/`provincia`; `ubicacion` es texto libre tipo "a 1,2 km de la playa"): hoy sale "Población (Provincia)"; la función ya admite `street`/`postcode` si aparece una fuente. Fila "Dirección" en "Estancia" (cualquier estado).
- **§5.2 Compatibilidad**: `detail.dogs_compatible` = `snapshot.compatibility.compatible` si el snapshot la trae y hay perros declarados; si no, null (snapshots antiguos → no se muestra nada). Nunca contra la política viva. UI: «Tus perros cumplen las condiciones de esta reserva» solo si `true`.
- **§13 Valoración**: `capabilities.has_feedback`, `capabilities.review_deadline_passed` y `detail.my_feedback` ({type, rating, comment, submitted_at}, sin `report_reason`) desde la fila `reservation_guest_feedback` que el detalle ya cargaba. UI finalizada: enviada → «Valoración enviada» + «Ver mi valoración» (solo lectura); `can_review` → botón Valorar; plazo vencido → `cv_det_valorar_vencida`; resto → `cv_det_valorar_no_disponible`.
- **§12 Comunicaciones**: ninguna tabla existente guarda el consentimiento (`v4p_jnewsletter0` = contador ip/día; `v4p_jmarketing0` = socios Club legacy por email). Migración `1791400000007-juser-profiles-marketing-opt-in.ts` (`marketing_opt_in TINYINT(1) NULL DEFAULT 0`, `marketing_opt_in_at DATETIME NULL` en `v4p_juser_profiles`, guardas information_schema). `php/traveler_profile_api.php`: `GET comms_get`, `POST comms_update {marketing_opt_in: bool}` (CSRF, user_id de sesión; la fecha solo cambia si cambia el valor; sin columnas → `available=false` / 503). Bloque "Comunicaciones" en Mi perfil (OFF por defecto, ayuda: los emails transaccionales no son opcionales).
- **§14 Confirmación**: `/mi-reserva/confirmacion/{id}` (`.htaccess` ×2 y `production-htaccess`) → `xx/reservation-confirmation.php` + `php/reservation_confirmation_body.php` + `css/components/reservation_confirmation.css`. Sin sesión customer|host → 302 `soclogi`; datos con la misma llamada de detalle (`GET /traveler/{user_id sesión}/reservations/{id}`), 403/404 de la API → página 404 "no encontrada"; otro error → 502. Render desde snapshot (referencia, alojamiento/unidad/dirección, fechas, viajeros, perros, líneas + total + estado de pago, política + fecha límite exacta en la zona del alojamiento, condiciones Dog Friendly). Botón «Imprimir / Guardar PDF» (`window.print`, CSS de impresión), `noindex`, todo con `htmlspecialchars`. Enlace en el detalle para confirmed/in_progress/finalized/incident_review.
- **Textos**: seed `1791400000008-seed-panel-small-gaps-variables.ts` (página `cuenta_viajero`, `cv_det_*`, `cv_comms_*`, `cv_conf_*`, solo `description_l1`, sin emojis); PHP/JS con fallback en español.
- **Migraciones pendientes**: `1791400000007`, `1791400000008` (`npm run migration:run`).
- Tests: `traveler-detail.util.test.ts` (nuevo) y `traveler-reservation-panel.service.test.ts` (+4).

## 9. Pagar reserva inconclusa (pay-pending, 2026-10-23)

- **Modelo actual**: el checkout inmediato (`ReservationService.checkout`) crea la reserva `pending`/`pending` SIN bloquear noches (`insertWithoutInventoryHold`, B7) con `expiration_date = now + PENDING_RESERVATION_EXPIRATION_TIME` (31 min..24 h) y una Checkout Session con `expires_at == expiration_date` (idempotency `checkout:{id}`). La cancelan el cron `processPendingReservations` (expiration + 2 min de gracia, `cancel_reason=expired`) o `checkout.session.expired` (`checkout_session_expired`). Las noches solo se bloquean al pagar (`activateFromPayment`; si ya no están libres → reembolso automático).
- **Regla pagable** (`resolveTravelerPayability`, `utils/traveler-panel-status.util.ts`): `pending` + pago `pending` + `expiration_date > now` + check-in no pasado. Card y `capabilities` llevan `can_pay` + `pay_expires_at`. El listado ya incluía las pendientes no caducadas en "Próximas" (`payment_pending` → "Pago pendiente"); las caducadas siguen ocultas (D-12).
- **Ruta** `POST /v1/traveler/:user_id/reservations/:id/pay` (InternalApiKeyGuard, `TravelerReservationPayService`): 404/403 propiedad; 409 `already_paid`/`not_payable`, 410 `expired` (también canceladas por caducidad); re-chequeo de fechas (bloqueos, filas de disponibilidad, otras reservas) → 409 `unavailable`; sesión actual `open` → se reutiliza su url; `complete` → 409 `payment_processing`; `expired`/inexistente → NUEVA sesión de la MISMA reserva con el mismo builder (`createReservationCheckoutSession`: líneas congeladas, `expectedChargeCents`, mismo metadata/transfer_group/success_url), `expires_at = min(expiration_date, now+24h)` (nunca se amplía; < 31 min → 410), idempotency `checkout:{id}:retry:{sesión reemplazada|none}`, compare-and-set `replaceCheckoutSessionId` (payment row: `attempts+1`, evento `checkout_session_replaced`; si pierde → 409 `session_conflict` y se expira la sesión creada). Respuesta `{reservation_id, checkout_url (solo https *.stripe.com), expires_at, reused}`.
- **Webhooks**: `checkout.session.expired`/`async_payment_failed` de una sesión que ya no es la actual no cancelan (comprobación previa + `expirePendingReservation(..., {onlyIfSessionId})` bajo el lock de fila). `completed` ya era seguro para cualquier sesión (importe vs `expectedChargeCents`, duplicados → reembolso).
- **Web**: `php/booking_traveler_api.php?action=reservation_pay` (POST + CSRF, user_id de sesión, url validada, códigos estables). `TA.renderPayAction` (`js/traveler_account.js`) en card del listado, detalle (con aviso) y próximo viaje de Inicio: botón «Pagar reserva» + "Disponible hasta {fecha}", spinner, redirección; errores inline (caducada / fechas no disponibles / procesando / pagada / genérico). Vuelta por el `success_url` existente (`reserva-exito`).
- **Textos**: seed `1791400000009-seed-panel-pay-pending-variables.ts` (`cv_pagar_*`), fallback en JS. **Migración pendiente**: `1791400000009`.
- Tests: `traveler-reservation-pay.test.ts` (nuevo, 15), `traveler-reservation-panel.service.test.ts` (+1), `traveler-panel-status.util.test.ts` (+2), guard coverage.

## 10. Pestaña "Incidencias" con chat + emails en cada mensaje (2026-10-25)

Petición: en el panel del perfil, una pestaña de incidencias separadas por alojamiento, con el detalle de
cada una; intercambio tipo chat y, por ahora, un email al administrador y al usuario en cada mensaje.

**API (booking, InternalApiKeyGuard, en la lista interna de `guard-coverage.test.ts`)**

- `GET /v1/traveler/:user_id/incidents` → `{items, total}`: todas las incidencias de las reservas del usuario
  (propiedad estricta por `reservations.user_id`), última actividad primero. Cada item: `id, incident_ref (#INC-N),
reservation_id, reservation_ref, type, status, is_open, blocks_payout, created_at, updated_at, last_activity_at,
last_message_preview (≤140, o la descripción si no hay mensajes), last_message_author, message_count,
attachment_count, site_id, site_name, site_town (jsites1.poblacio; fallo → null), checkin, checkout`.
  `TravelerIncidentInboxService` (solo lectura).
- `GET /v1/traveler/:user_id/incidents/:incident_id` → incidencia del viajero (como F-PV7a) + `incident_ref,
reservation_ref, site_*, checkin, checkout, last_activity_at` y `author_display` por mensaje ("Tú" / "Equipo V4P").
  403 si la reserva es de otro usuario, 404 si no existe (`ReservationIncidentService.getForTraveler`).

**Reglas del chat**

- El viajero puede escribir en cualquier estado abierto (`received`, `in_review`, `needs_info`); `can_reply` = abierta.
  Resuelta → 409 con `code: incident_closed` (el proxy lo conserva). Responder a `needs_info` sigue pasando a `in_review`.
- V4P (admino) escribe en cualquier estado abierto (sin cambios). Las notas de estado que ve el viajero también cuentan.

**Emails (best effort, tras el commit, nunca rompen la petición; errores al log)** — `ReservationIncidentNotificationService`
| Evento | Destinatarios | Plantilla |
| --- | --- | --- |
| Mensaje del viajero | admin (`BOOKING_ADMIN_EMAIL`) + copia al viajero | `incident_message_admin` + `incident_message_traveler` |
| Mensaje de V4P | viajero + copia al admin (con el actor) | `incident_message_traveler` + `incident_message_admin` |
| Nota de `needs_info`/`in_review` (crea mensaje) | viajero + copia admin | ídem (`event: status_note`) |
| Paso a `resolved` con nota (resolution_note) | viajero + copia admin | ídem (`event: resolved`; re-envío idempotente no repite) |
| Apertura de la incidencia | admin: `incident_opened_admin` (como antes); viajero: confirmación | `incident_message_traveler` (`event: opened`) |
Email del viajero: `v4p_juser_profiles.email` por `reservation.user_id`, si no `reservation.guest_email`. Asunto p. ej.
"Nuevo mensaje en tu incidencia #INC-{id} (#RES-{res})". HTML con todo el contenido escapado + alternativa en texto
(`SendMailOptions.text`). En no-producción se redirige a `BOOKING_DEV_EMAIL` como el resto.
Enlaces: panel `(BOOKING_WEB_URL ?? FRONTEND_URL)/mi-perfil-textos?selTab=tv_incidencias&inc={id}`; admin
`BOOKING_ADMIN_URL` (nuevo, opcional; por defecto `(BOOKING_WEB_URL ?? FRONTEND_URL)/admino`) + `/php/admIncidencia.php?id={id}`.

**Web**

- Pestaña `tv_incidencias` para viajero y anfitrión (después de Mis reservas / Mis viajes), en el menú de cuenta
  (escritorio y móvil, `acct_incidencias`) y `socprofile?selTab=incidencias` → `tv_incidencias` (+ `inc`).
- `components/traveler_incidents_tab.php` + `js/traveler_incidents_inbox.js`: bandeja agrupada por alojamiento
  (cabecera nombre/población; fila: tipo, estado funcional, #RES, fechas, último mensaje, última actividad, contadores),
  conversación en burbujas (viajero derecha, V4P izquierda, hora; la descripción es el primer mensaje), adjuntos con
  descarga por el proxy, caja de mensaje + adjuntos (reutiliza `TravelerIncidents.uploadFiles`) mientras está abierta,
  aviso "Te enviaremos una copia por email"; resuelta → nota de solo lectura; vacío → "Las incidencias se abren desde
  el detalle de cada reserva" + enlace a Mis reservas. Enlace profundo `?selTab=tv_incidencias&inc=N`.
- Detalle de reserva: la incidencia muestra su historial en solo lectura + botón "Ver conversación" (cambia a la
  pestaña sin recargar). Responder/adjuntar ya no se hace allí (una sola caja de chat).
- Proxy: `incidents_inbox` (GET), `incident_thread` (GET, `incident_id`); `incident_message` ahora con
  `bta_call_coded` (409 `incident_closed`). Desenvuelve `{ok,status,data}` como el resto (`bta_call_soft`).
- Admino: la conversación se pinta en burbujas; aviso de que cada respuesta llega por email al viajero.
- CSS en `css/components/traveler_account.css` (se carga aparte con filemtime) y `admino/css/admOps.css`.
