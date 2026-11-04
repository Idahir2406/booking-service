# Backoffice fase 1 — Incidencias (admino "OPERACIONES RESERVAS")

Bandeja y detalle de incidencias de viajeros (F-PV7a) dentro del admino legacy.

**Decisión:** no se usa el CRUD genérico `jGlobal_data.php`/jtables. Se saltaría la máquina de estados,
los bloqueos de fila (`FOR UPDATE`), `transitionPayout` y la auditoría. Las páginas propias de admino hablan
con la API interna de booking a través de **un único proxy PHP** (`web/admino/php/admOps_api.php`).

```
navegador (admino) ──► admOps_api.php (sesión admino + CSRF + validación) ──► booking /v1/incidents* (X-Internal-Key)
                                  └─► traveler_media_lib.php (descarga del adjunto privado)
```

## 1. Rutas de booking (todas con `InternalApiKeyGuard`, en la lista interna de `guard-coverage.test.ts`)

| Método | Ruta                                                                     | Uso                                                              |
| ------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| GET    | `/v1/incidents?status=&type=&blocks_payout=&from=&to=&q=&limit=&offset=` | Bandeja paginada                                                 |
| GET    | `/v1/incidents/:incident_id`                                             | Detalle completo                                                 |
| GET    | `/v1/incidents/:incident_id/attachments/:attachment_id`                  | Metadatos + `storage_key` para que el proxy sirva el fichero     |
| POST   | `/v1/incidents/:incident_id/status` (ya existía)                         | `{status, note?, release_hold?}` + cabeceras de actor opcionales |
| POST   | `/v1/incidents/:incident_id/messages` (ya existía)                       | `{body}` + cabeceras de actor opcionales                         |

Las rutas del viajero (`/v1/traveler/...`) no cambian.

### GET /v1/incidents

- `status`: `received|in_review|needs_info|resolved|open` (`open` = las tres abiertas). `type`: catálogo `INCIDENT_TYPE`.
  `blocks_payout`: `true|false|1|0`. `from`/`to`: `YYYY-MM-DD` inclusivas sobre `created_at`.
  `q` (≤ 100): `#RES-123`/`RES-123`/`123` → por reserva o id de incidencia; con `@` → email (perfil legacy o
  `guest_email`); si no → nombre del viajero / huésped / alojamiento. `limit` 1–100 (25), `offset` ≥ 0.
- Respuesta `{items[], total, limit, offset, status_counts{received,in_review,needs_info,resolved}}`
  (`status_counts` aplica el resto de filtros, no el de estado).
- Item: `id, reservation_id, reservation_ref ("#RES-{id}"), type, status, created_at, updated_at, age_hours,
blocks_payout, dispute_id, reservation_status, payment_status, payout_status, checkin, checkout, site_name,
traveler_name, traveler_email, message_count, attachment_count, last_activity_at`.
- SQL crudo vía `MysqlService` (JOIN `reservations`, `v4p_jsites1`, `v4p_juser_profiles`), construido en
  `utils/incident-admin.util.ts` solo con constantes + placeholders. Nombre/email: perfil legacy y, si falta,
  `guest_name`/`guest_email` de la reserva.

### GET /v1/incidents/:incident_id

`id, reservation_ref, type, status, description, blocks_payout, resolution_note, resolved_at, created_at,
updated_at, age_hours, traveler{user_id,name,email}, messages[] {id, author_type traveler|admin, body,
created_at, actor{id,name}|null}, attachments[] {id, original_name, mime, size_bytes, uploaded_by, created_at}`
(**nunca** `storage_key` ni rutas), `history[]` (eventos `incident_*` de `reservation_events` con from/to,
release_hold, payout_hold y actor), `dispute{id,status,source,closed_at,created_at}|null`,
`reservation{status, payment_status, payout_status, site/room id+nombre, checkin, checkout, guests, pets,
total_cents, amount_refunded_cents, currency, guest_name, guest_email, snapshot (perros, régimen, servicios del
snapshot congelado; null en reservas legacy)}`, `allowed_next_statuses` (sale de `incidentStateMachine`),
`release_hold{applicable, reason, other_open_disputes, host_amount_cents, currency}`, `can_message`.

`release_hold.applicable` = el estado permite `resolved` (o ya está resuelta: reenvío idempotente) **y** la
incidencia bloquea (`blocks_payout`) **y** `payout_status = blocked`. `reason`: `status_not_resolvable |
incident_not_blocking | payout_not_blocked`. `host_amount_cents` = `computePlatformFee(...).hostAmountCents`
(estimación; el importe real lo calcula el cron de liberación).

## 2. Auditoría del actor

- Cabeceras opcionales en las mutaciones: `x-actor-id` (entero positivo) y `x-actor-name` (1–100
  caracteres imprimibles). Inválidas → 400. Sin cabeceras → comportamiento anterior (admin anónimo "v4p").
- **Sin migración** (no hace falta `1791400000012-incident-admin-actor.ts`). Se reutiliza JSON existente:
  - `reservation_events.payload.actor = {id, name}` en `incident_status_changed` e `incident_message_admin`;
    además `payload.message_id` enlaza el mensaje creado (nota de `needs_info`/`in_review` o mensaje) con su actor.
  - `audit_logs` (liberación `blocked → held`): `actor_type = admin`, `actor_id = id` o `admino:{name}`
    (varchar 64), `metadata.actor_name`.
  - El detalle reconstruye `messages[].actor` e `history[].actor` desde esos eventos.
- `v4p_jusers` (login admino) **no tiene id numérico** (PK = `user`), por eso el proxy solo envía
  `x-actor-name = $_SESSION['userid']`.

## 3. Proxy `web/admino/php/admOps_api.php`

- Sesión admino obligatoria (`$_SESSION['userid']` string no vacío) → si no, `401 {ok:false,message:"unauthorized"}`.
- Lista blanca de acciones + método (405 si no coincide). Todo POST exige `X-CSRF-Token` =
  `$_SESSION['adm_ops_csrf']` (creado por `admOps_lib.php`, admino no tenía token) → si no, 403 `invalid_csrf`.
- X-Internal-Key solo en servidor (`bw_internal_key()`/`bw_api_base()` de `inc/booking_wizard_lib.php`).
- Errores normalizados: 400/404/409/422/429 de la API se conservan con código estable; 401 de la API, red o
  5xx → `502 upstream_error`. El texto interno de la API va a `error_log`, nunca al navegador.
- Defensa en profundidad: elimina cualquier clave `storage_key` de las respuestas JSON.

| Acción                | Método    | Entrada                                                       | API                                                                                                                                                                 |
| --------------------- | --------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------- |
| `incidents_list`      | GET       | status, type, blocks_payout (1/0), from, to, q, limit, offset | GET /incidents                                                                                                                                                      |
| `incident_detail`     | GET       | id                                                            | GET /incidents/:id (+ `download_url` por adjunto)                                                                                                                   |
| `incident_status`     | POST JSON | incident_id, status (`in_review                               | needs_info                                                                                                                                                          | resolved`), note (≤ 2000; obligatoria en needs_info), release_hold (bool, solo con resolved) | POST /incidents/:id/status |
| `incident_message`    | POST JSON | incident_id, body (1–2000)                                    | POST /incidents/:id/messages                                                                                                                                        |
| `incident_attachment` | GET       | incident_id, attachment_id                                    | GET /incidents/:id/attachments/:aid → `tml_serve_download` (attachment, nosniff, CSP sandbox, no-store) solo si la API confirma que el adjunto es de esa incidencia |

## 4. Páginas

- `admSelect.php`: nuevo bloque **OPERACIONES RESERVAS → INCIDENCIAS** (único cambio en ficheros admino existentes).
- `admIncidencias.php` (bandeja): filtros estado (por defecto "Abiertas"), tipo, bloquea pago, fechas,
  búsqueda (#RES / email / nombre); contadores por estado clicables; tabla con antigüedad resaltada
  (abiertas: ámbar > 24 h, rojo > 72 h), estado del pago al anfitrión; paginación de 25; filtros en la URL.
- `admIncidencia.php?id=N` (detalle): resumen de reserva, badge de payout, conversación, adjuntos (descarga vía
  proxy), historial con actor, caja de respuesta, acciones limitadas a `allowed_next_statuses`:
  - "Necesitamos información" exige nota.
  - "Resolver" pide confirmación; con "Liberar pago al anfitrión" marcado (solo si `release_hold.applicable`)
    el confirm indica el importe estimado, que la disputa se cierra, que el pago pasa a "retenido" y se
    transferirá en el próximo proceso automático, y si otras disputas lo mantendrán bloqueado.
  - Incidencia ya resuelta que aún bloquea: botón "Liberar pago al anfitrión" (reenvío idempotente).
  - Tras cada acción se recarga el detalle y se muestra el resultado (incluido `payout_hold`).
- JS: `web/admino/js/admOps_incidents.js` (ES5 + jQuery de admino; todo con `.text()`). CSS: `web/admino/css/admOps.css`.
- Textos en castellano escritos en el código (admino ya lo hace en `admSelect.php`/`admReservas.php`;
  `admLang.php` solo tiene textos del CRUD genérico).

## 5. Checklist de prueba manual

Requisitos: migraciones F-PV7a aplicadas, booking con `INTERNAL_API_KEY` = `BOOKING_INTERNAL_KEY` del PHP.

1. Sin sesión admino: `admIncidencias.php`/`admIncidencia.php?id=1` redirigen a `admLogin.php`;
   `admOps_api.php?action=incidents_list` → 401 JSON.
2. Login admino → admSelect muestra "OPERACIONES RESERVAS → INCIDENCIAS".
3. Bandeja: por defecto solo abiertas; contadores coherentes; filtros tipo/bloquea pago/fechas; buscar
   `#RES-{id}`, email del viajero y nombre; paginación con > 25 incidencias; antigüedad ámbar/roja.
4. Detalle de una incidencia `during_stay` con pago `blocked`: badge "Bloqueado", disputa abierta, adjuntos
   descargables (se descargan como fichero, no se abren inline); el `storage_key` no aparece en la respuesta
   de red.
5. "Necesitamos información" sin nota → error; con nota → estado `needs_info`, el viajero ve el mensaje en su
   panel; el historial muestra el login admino.
6. Mensaje al viajero → aparece en la conversación con "V4P · {login}".
7. "Resolver" sin liberar → confirm avisa de que el pago sigue bloqueado; el pago sigue `blocked`; aparece
   "Liberar pago al anfitrión"; al usarlo → confirm con importe → `payout_status = held`,
   `audit_logs.actor_id = admino:{login}`.
8. Dos pestañas: resolver en una y actuar en la otra → mensaje de conflicto y recarga.
9. POST sin `X-CSRF-Token` (curl con cookie de sesión) → 403 `invalid_csrf`.
10. Descarga con `attachment_id` de otra incidencia → 404.

## 6. Pendiente / no verificado

- Ejecución contra MariaDB real (solo tests unitarios con store en memoria / mysql simulado).
- `admReservas.php` borra todas las claves de sesión salvo `userid/url/dbName`: si se abre en otra pestaña,
  el token CSRF se pierde y el siguiente POST da 403 (recargar la página lo regenera).
- `admLogout.php` deja `userid = ""`: `admSelect.php` (isset) lo sigue aceptando; las páginas nuevas exigen
  login no vacío.

## 7. Chat + emails (2026-10-25)

- Cada mensaje de V4P (`POST /v1/incidents/:id/messages`) y cada nota que ve el viajero (`needs_info`/`in_review`
  con nota, `resolved` con nota) envía un email al viajero y una copia a `BOOKING_ADMIN_EMAIL` (con el actor
  `x-actor-name`). Cada mensaje del viajero envía un email al admin con enlace a `admIncidencia.php?id=N`
  (`BOOKING_ADMIN_URL`, por defecto web + `/admino`). Best effort tras el commit.
- El viajero puede escribir en cualquier estado abierto; resuelta → 409 `incident_closed` (aquí sigue llegando como `conflict`).
- `admIncidencia.php`: conversación en burbujas (viajero izquierda, V4P derecha) y aviso de email en la caja de respuesta.
- Detalle completo: `docs/panel-viajero/PLAN-desarrollo-panel-viajero-v1.md` §10.
