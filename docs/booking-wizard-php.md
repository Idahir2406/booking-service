# Wizard de reserva PHP (`/reservar/{id}-{alias}`)

Sustituye a la app React `booking-frontend` (**deprecada**, ya no se usa ni se carga). Todo el flujo es
PHP + JS plano del sitio; el navegador nunca habla con la booking API.

## Flujo

1. `.htaccess`: `reservar/(.+)` → `xx/reservation-book.php?siteid=$1` (QSA). Entrada desde la ficha
   (`php/pageSitesElement.php`, solo `ENVIRONMENT=development`); sin parámetros. Prefill opcional:
   `?room_id=&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&guests=N`.
2. `php/reservation_book_body.php`: carga `$vble` (páginas `alojamiento` + `reserva_checkout`), valida el
   alojamiento (premium, `reserva='F'`, email) y `bookingResolveOnlineCheckout()` (Stripe Connect listo +
   habitaciones públicas). Si no, tarjeta "Reserva no disponible".
3. `components/reservation_book_wizard.php` pinta en servidor los 4 pasos + resumen lateral y deja la
   configuración en `<script type="application/json" id="rbw_cfg">` (habitaciones saneadas, CSRF, prefill,
   perros guardados, textos). Sin URL de la API, sin claves, sin `traveler_token`.
4. `js/reservation_book.js` (vanilla, `textContent` para todo dato externo):
   - **1 Habitación**: tarjetas + régimen (radio si hay >1 opción; nombre por código vía jvariables).
   - **2 Fechas/huéspedes/perros**: calendario público (12 meses, 2 meses desktop / 1 móvil; el día de salida
     puede estar ocupado si todas las noches son reservables; mín./máx. noches del día de entrada), huéspedes
     (≤ `max_guests`), perros (nombre, peso con coma, PPP; hasta 20). Presupuesto con debounce (400 ms):
     tamaño derivado, ficha de política, compatibilidad (verde / bloque con todas las violaciones),
     nota de perros de asistencia. "Mis perros" (viajero logueado): ver **Perros del paso 2** abajo.
   - **3 Resumen**: servicios para perros, adicionales y extras (`available_*` de la API; cantidad 1-20;
     `requires_dogs`), desglose `price_lines`, total `totals.total_cents`, fianza (`deposit.message`).
   - **4 Datos + pago**: nombre, email, teléfono, observaciones + aceptación de condiciones (enlace `/legal`)
     - nota "Serás redirigido a Stripe" (`nrf_payment_intro`). En este paso "Continuar" se oculta y la barra de
       navegación muestra **"Pagar"** (`#rbw_pay`, `nrf_btn_pay`): valida contacto + condiciones (errores en
       `#rbw_errors`) → `checkout` → `window.location.assign(checkout_url)` (Stripe Checkout). Mientras espera,
       "Pagar" y "Atrás" quedan deshabilitados (`setPaying`); un error (409 `unavailable`, 422
       `dogs_incompatible`, `invalid_*`…) se pinta en el mismo bloque de errores y reactiva los botones.
       El total/resumen es el del panel lateral (no se duplica). Antes había un paso 5 "Pago" separado
       (eliminado 2026-10-23: solo era el botón de redirección).
5. Stripe vuelve a `reserva-exito` / `reserva-cancelada` (PHP, sin React; `js/booking_reservation_success.js`
   y `js/booking_reservation_feedback.js` siguen llamando a las rutas públicas GET de la API).

El precio **siempre** lo calcula la API (`/reservations/quote` y `/reservations/checkout` usan el mismo motor F2).

## Perros del paso 2

- **Chips "Tus perros guardados"** (solo viajero logueado, `cfg.savedDogs` con `id`): cada perro se añade
  **una sola vez**. El chip alterna: pulsar añade la fila, pulsar otra vez la quita (`.is-selected` +
  `aria-pressed`). La fila lleva `data-saved-dog-id` (se rastrea por id, nunca por nombre); al quitar la fila
  con "Quitar" el chip vuelve a estar disponible.
- **Límite**: `min(20 (MAX_DECLARED_DOGS), room.max_pets si > 0, quote.dog_policy.max_dogs si > 0)`. Al
  alcanzarlo: chips no seleccionados `aria-disabled="true"` (`.is-disabled`), "Añadir perro" y
  "Añadir nuevo perro" deshabilitados; se re-evalúa al cambiar de habitación y con cada presupuesto.
- **"Añadir nuevo perro"** (viajero logueado): abre **el mismo diálogo de Mis perros** —
  `web/js/traveler_dog_dialog.js` (`window.TravelerDogDialog.openDogForm`), extraído de
  `js/traveler_dogs.js`, que ahora también lo usa—. Nombre, peso, PPP y foto opcional; `role="dialog"` +
  `aria-modal`, foco al nombre, Tab atrapado, Esc / clic fuera cierran, foco vuelve al botón (o al chip nuevo si
  el botón quedó deshabilitado). Guarda vía `php/booking_traveler_api.php` (`dog_create`, y
  `dog_photo_upload` si hay foto) con `window.TravelerAccount` (`js/traveler_account.js`); el CSRF es el mismo
  `$_SESSION['fsc_csrf']` de `bw_csrf_token()` que usan los dos proxies. El wizard emite
  `window.__TRAVELER_ACCOUNT_CFG__` (apiUrl, csrf, locale, textos `cv_*`) y carga
  `traveler_account.js` + `traveler_dog_dialog.js` antes de `reservation_book.js`; `xx/reservation-book.php`
  enlaza `css/components/traveler_account.css` (solo clases `.ta-*`) para el viajero logueado. Tras guardar, el
  perro aparece como chip y se añade a la reserva (una vez). Máximo 10 guardados (`cfg.savedDogsMax`): al
  llegar se oculta el botón y se muestra `cv_dogs_max`.
- **Sin repetidos** (nombre `trim` + sin mayúsculas/acentos): el diálogo bloquea un nombre que ya existe en
  "Mis perros" (`nrf_dog_duplicate_saved`) o en la reserva (`nrf_dog_duplicate_name`) sin llamar a la API; dos
  filas con el mismo nombre (guardadas o escritas a mano) → error en línea en la fila repetida
  (`aria-invalid`) y no deja continuar; un chip cuyo nombre ya está en una fila manual no se añade y marca esa fila.
- **Invitados**: filas manuales como siempre (sin chips ni diálogo); la regla de nombres repetidos aplica igual.
- **Enlace reserva ↔ "Mis perros"** (spec 2.2/2.3): las filas con `savedId` envían `dogs[].saved_dog_id`
  (quote + checkout; `booking_reservation_api.php` solo reenvía enteros > 0, el resto se omite). El quote lo
  ignora. El checkout lo guarda en `SnapshotDog.saved_dog_id` (snapshot JSON, **sin migración**, solo
  snapshots nuevos) únicamente si el perro es activo (no borrado) del viajero del `traveler_token`
  (`TravelerDogsService.findActiveOwnedIds`); invitado, ajeno, borrado, repetido o fallo de lectura → se
  descarta (log debug/warn) y la reserva sigue; precio intacto. El detalle del panel
  (`GET /traveler/:user/reservations/:id`) devuelve `dogs[].saved_dog_id` (o null); el proxy
  `booking_traveler_api.php` (`reservation_detail`) añade `photo_url` (proxy `dog_photo`) si ese perro sigue
  en "Mis perros" con foto (una llamada a dogs por detalle, solo si hay enlaces) y
  `js/traveler_reservations.js` pinta avatar (foto o inicial) + nombre + peso/PPP. Las cards del listado no
  tienen datos de perros (solo `dogs_count`): sin avatares.

## Proxy `web/php/booking_reservation_api.php`

| Acción     | Método | CSRF (`X-CSRF-Token` = `$_SESSION['fsc_csrf']`) | API                                                   |
| ---------- | ------ | ----------------------------------------------- | ----------------------------------------------------- |
| `calendar` | GET    | no                                              | `GET /v1/reservations/public/rooms/:room_id/calendar` |
| `quote`    | POST   | sí                                              | `POST /v1/reservations/quote`                         |
| `checkout` | POST   | sí                                              | `POST /v1/reservations/checkout` (+ `traveler_token`) |

- Lista blanca de acciones/métodos, validación de tipos y límites (mismos que `QuoteReservationDto`),
  `accept_terms === true` obligatorio en checkout, `checkout_url` solo si es `https://*.stripe.com`.
- `traveler_token` se firma en el proxy desde `$_SESSION['user_id']` (`bookingTravelerToken()`); invitado = sin token.
- Errores normalizados: `invalid_*`, `invalid_csrf`, `terms_required`, `dogs_incompatible` (422, con
  `errors`/`violations`), `invalid_reservation` (400), `unavailable` (409), `not_found`, `booking_api_*` (502).

## Ficheros

- Nuevos: `web/php/booking_reservation_api.php`, `web/js/reservation_book.js`,
  `web/css/components/reservation_book.css`, `web/inc/reservation_book_texts.php`,
  `booking/src/database/migrations/1791400000002-seed-reserva-checkout-variables.ts`,
  `web/js/traveler_dog_dialog.js` (diálogo de perro compartido con Mis perros),
  `booking/src/database/migrations/1791400000003-seed-reserva-dogs-variables.ts`.
- Reescritos: `web/components/reservation_book_wizard.php`, `web/xx/reservation-book.php` (sin
  `booking_react_assets.php`; enlaza `new_reservation_form.css` + `reservation_book.css` con `filemtime`).
- Deprecados (sin uso): `web/inc/booking_react_assets.php`, `web/js/booking_reservation_checkout.js`,
  `booking-frontend/`.

## Textos

Página jvariables `reserva_checkout` (130 claves `nrf_*` usadas, mapa en `web/inc/reservation_book_texts.php`).
Seed: `1791400000002-seed-reserva-checkout-variables.ts` (idempotente, solo `description_l1`; ya ejecutada en
local) + `1791400000003-seed-reserva-dogs-variables.ts` (8 claves nuevas de perros: `nrf_saved_dogs_empty`,
`nrf_saved_dog_selected`, `nrf_dog_create_new`, `nrf_dog_create_notice`, `nrf_dog_created`,
`nrf_dog_duplicate_name`, `nrf_dog_duplicate_saved`, `nrf_dogs_limit_reached`; **pendiente de ejecutar**).
`nrf_step_payment`, `nrf_step5_title` y `nrf_step5_hint` siguen en BD (seed 0002) pero ya no se usan.
El diálogo de perro usa los `cv_*` de la página `cuenta_viajero` (`reservation_book_dog_dialog_texts()` los lee de
BD con fallback en `reservation_book_dog_dialog_text_map()`).
Los textos que devuelve la API (errores, violaciones de perros, líneas de precio, modo de precio, fianza)
llegan en español desde Nest.

## Prod

`css/all.css` no incluye los CSS de componentes: se enlazan explícitamente. Subir los 7 ficheros web y
ejecutar la migración en el entorno. Cambio perros (2026-10-23): subir además `js/traveler_dog_dialog.js`,
`js/traveler_dogs.js`, `components/traveler_dogs_tab.php`, `css/components/traveler_account.css` y ejecutar
`1791400000003`.

## Checklist de prueba manual

- [ ] `/reservar/{id}-{alias}` carga (200) sin avisos PHP; alojamiento no apto → tarjeta "no disponible".
- [ ] Paso 1: sin habitación → error; con 1 habitación viene preseleccionada; régimen solo si hay >1.
- [ ] Paso 2: días pasados/ocupados/bloqueados no seleccionables; salida en día ocupado permitida;
      mín./máx. noches; "Borrar fechas"; navegación de meses; 1 mes en móvil.
- [ ] Huéspedes > máximo → error. Peso inválido (0,3 / 130 / texto) → error del campo.
- [ ] Perro 30 kg PPP en alojamiento "hasta Mediano, sin PPP" → bloque rojo con 2 incompatibilidades, no deja continuar.
- [ ] Perro 8,5 kg → "Tamaño: Pequeño", bloque verde, total actualizado.
- [ ] Viajero logueado con "Mis perros": pulsar un chip lo añade (✓, `aria-pressed=true`); pulsar otra vez lo
      quita; nunca se duplica. "Quitar" en la fila → el chip vuelve a "+".
- [ ] Habitación con `max_pets=2`: con 2 perros los demás chips quedan `aria-disabled` y los botones de añadir deshabilitados.
- [ ] "Añadir nuevo perro": mismo diálogo que Mis perros; nombre ya guardado (p. ej. con otra mayúscula/acento)
      → error sin petición; nombre nuevo → `dog_create` 201, aparece como chip y fila. Esc / clic fuera cierran.
- [ ] Dos filas con el mismo nombre ("Oly" y " óly ") → error en la fila y no deja continuar (también invitado).
- [ ] Paso 3: servicios/extras (si el alojamiento tiene) recalculan desglose y total; `requires_dogs` sin perros deshabilitado; fianza visible si aplica.
- [ ] Stepper con 4 pasos (Habitación · Fechas · Resumen · Datos).
- [ ] Paso 4: "Continuar" oculto, "Pagar" visible; email/teléfono inválidos o condiciones sin marcar → error
      sin llamar a checkout; doble clic no duplica (botón deshabilitado con spinner).
- [ ] Paso 4: Pagar → Stripe Checkout; cancelar en Stripe → `reserva-cancelada`; pagar → `reserva-exito`.
- [ ] Viajero logueado → la reserva aparece en su panel (reservations.user_id).
- [ ] POST al proxy sin `X-CSRF-Token` → 403 `invalid_csrf`; acción desconocida → 400; GET a `quote` → 405.
