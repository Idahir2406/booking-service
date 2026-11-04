# F2 — Precio completo en presupuesto y checkout

Fase 2 del plan de pagos V4P. Construye sobre F0 (`F0-seguridad-y-bugs-criticos.md`) y
F1 (`F1-modelo-economico.md`). Objetivo: que el viajero declare sus perros, se valide la
compatibilidad con la política de la unidad, y que **presupuesto, checkout, Stripe, snapshot y
emails** usen el mismo precio completo por líneas (alojamiento, régimen, suplemento de perro,
servicios de pago y extras), con la comisión V4P congelada sobre la base comisionable.

> **Sin migraciones nuevas.** F2 solo usa tablas existentes (F1 + wizard). Requiere F0 y F1
> aplicadas (`1791000000000`, `1791000000100`).

Referencias: IMPLEMENTACIÓN PERROS B2/B2.1/B3/B3.1/B4/B5/B6/B7, C2/C5/C6/C7; manual de pagos
A2 (12 %), A3 (comisionable), A4/A11 (penalizable / opcionales), A10 (snapshot), A26 (fianza).

---

## 1. Qué cambia

| Antes (F1)                                                         | Ahora (F2)                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Solo `pets` (número) validado contra `rooms.max_pets`.             | `dogs: [{name, weight_kg, is_ppp, room_id?}]`: tamaño derivado del peso (`dog_sizes`), validación de tamaño/PPP/número contra `unit_pet_policies` + `site_settings`. Todas las incompatibilidades en una respuesta (422). `pets` sigue funcionando (modo legacy).                          |
| Precio = alojamiento + régimen (floats + línea de ajuste).         | Una **función pura** (`priceReservation`) en céntimos enteros: alojamiento, régimen, suplemento de perro, servicios para perros, servicios adicionales y extras de la habitación. Presupuesto y checkout usan **las mismas líneas**.                                                       |
| `commission_cents = 12 % × total`.                                 | `commission_cents = round_half_up(12 % × Σ líneas comisionables)` (A2/A3). Hoy todas lo son; la tasa turística (hook) no.                                                                                                                                                                  |
| Stripe: una sola línea con el total.                               | Una línea de Stripe por línea de precio (nombres en español); `SUM = total_cents` garantizado (si no, una línea única). Metadata `reservation_id`, `total_cents`, `transfer_group`.                                                                                                        |
| Webhook comprueba `subtotal + commission`.                         | Comprueba `total_cents` (filas legacy: regla anterior).                                                                                                                                                                                                                                    |
| Snapshot v1: estancia, habitación, régimen, líneas.                | Snapshot v1 ampliado (`pricing_version: "f2"`): perros con tamaño, política de perros de la unidad completa, servicios/extras con modo de precio, fianza informativa, compatibilidad, comisión sobre base comisionable. Copia profunda: cambios posteriores del anfitrión no afectan (C7). |
| El navegador enviaba `user_id` al checkout (riesgo abierto de F0). | El id del viajero va **firmado por PHP** (`traveler_token`, HMAC). `user_id` del navegador se descarta.                                                                                                                                                                                    |
| UI: contador de mascotas.                                          | UI: formulario de perros (añadir/quitar, nombre, peso, PPP), mensajes de compatibilidad en vivo, selección de servicios/extras con precio y modo explicado, desglose por líneas, caja de fianza y nota de perros de asistencia.                                                            |
| Email de confirmación: total.                                      | Email (Nest y PHP): perros, desglose por líneas y fianza.                                                                                                                                                                                                                                  |

---

## 2. Reglas de precio

### 2.1 Tipos de línea y flags

| Tipo (`reservation_price_lines.type`) | Origen                                                                             | Fórmula (céntimos)                                                                | Opcional | Comisionable | Penalizable |
| ------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------- | ------------ | ----------- |
| `accommodation`                       | `rooms.price_per_night`                                                            | `noches × precio`                                                                 | No       | Sí           | Sí          |
| `board`                               | `room_board_options`                                                               | `noches × suplemento` (incluido → 0 €, la línea se guarda igual con `quantity 1`) | No       | Sí           | Sí          |
| `dog_supplement`                      | `unit_pet_policies.supplement_mode/amount`                                         | ver 2.2                                                                           | No       | Sí           | Sí          |
| `dog_service`                         | `site_dog_supplies` (`state=yes`, `is_paid`, precio > 0, `pricing_mode` informado) | ver 2.3 × cantidad                                                                | **Sí**   | Sí           | **No**      |
| `additional_service`                  | `site_additional_services` (mismas condiciones)                                    | ver 2.3 × cantidad                                                                | **Sí**   | Sí           | **No**      |
| `extra`                               | `room_extras` activos de la habitación                                             | ver 2.4                                                                           | **Sí**   | Sí           | **No**      |
| `tourist_tax`                         | _hook_, sin fuente de datos                                                        | importe fijo                                                                      | No       | **No**       | No          |

- `total_cents = Σ amount_cents` de todas las líneas.
- `commission_cents = round_half_up(commission_rate × Σ comisionables)`, congelado en la reserva
  (`commission_rate` = `platform_settings.commission_rate`, 0.12).
- `quantity` = multiplicador entero (noches, perros × noches, …); `unit_amount_cents × quantity =
amount_cents` exacto ⇒ ya no hace falta línea `adjustment` de redondeo.
- `metadata.detail` guarda la fórmula legible ("2 perros × 3 noches × 15,00 €").

### 2.2 Suplemento por perro (B5/C5)

| `supplement_mode`          | Fórmula                   | Ejemplo (15 €, 2 perros, 3 noches) |
| -------------------------- | ------------------------- | ---------------------------------- |
| `per_pet_night`            | importe × perros × noches | 90,00 €                            |
| `per_pet_stay`             | importe × perros          | 30,00 €                            |
| `fixed_stay`               | importe                   | 15,00 € (fijo)                     |
| `none` / `null` / 0 perros | sin línea                 | —                                  |

"Perros" = perros declarados (o `pets` en modo legacy).

### 2.3 Servicios de pago (`pricing_mode` del wizard, paso 4)

| `pricing_mode`  | Fórmula                             | Etiqueta UI          |
| --------------- | ----------------------------------- | -------------------- |
| `per_stay`      | precio × cantidad                   | por estancia         |
| `per_night`     | precio × noches × cantidad          | por noche            |
| `per_pet_night` | precio × perros × noches × cantidad | por perro y noche    |
| `per_pet_stay`  | precio × perros × cantidad          | por perro y estancia |

Los modos "por perro" exigen al menos un perro (`service_requires_dogs`). Los servicios gratuitos
(`is_paid = false`) no se venden: están incluidos.

### 2.4 Extras de habitación (`room_extras.pricing_mode`)

| `pricing_mode`        | Fórmula                     |
| --------------------- | --------------------------- |
| `per_night`           | precio × noches             |
| `per_night_per_guest` | precio × noches × huéspedes |
| `per_stay`            | precio                      |

### 2.5 Fianza (B6/C6/A26)

Informativa: **no** es línea de precio, **no** suma al total, **no** la cobra V4P. Se muestra
antes del pago y se guarda en el snapshot:
"Fianza por posibles daños: 150,00 €. Se abonará directamente al alojamiento y no está incluida en
el importe de esta reserva. Devolución: … La fianza la gestiona el alojamiento; no se cobra en
Viajes 4Patas."

### 2.6 Tasa turística

No hay fuente de datos. `buildReservationPriceLines` acepta `touristTax` (línea `tourist_tax`, no
comisionable ni penalizable); el checkout pasa siempre `null` y la respuesta trae
`tourist_tax: null`. Ver preguntas abiertas.

---

## 3. Compatibilidad de perros (B3/C2)

Función pura `evaluateDogCompatibility` (`src/contexts/pet-policies/domain/dog-compatibility.ts`).

1. **Tamaño**: peso (0,5–120 kg, 2 decimales) → primera categoría por `rank` cuyo `max_kg` lo
   admite (`max_kg NULL` = sin tope). Semillas: Pequeño 0–10, Mediano 10,01–20, Grande 20,01–40,
   Extra grande > 40. Acumulativo: `rank(perro) ≤ rank(max_size_id)`; si el máximo es la
   categoría superior (XL / sin límite) se admite todo.
2. **PPP**: si `ppp_allowed = false`, cualquier perro PPP falla.
3. **Número**: `site_settings.max_pets` (o sin límite si `max_pets_unlimited`); sitios legacy sin
   `site_settings` → `rooms.max_pets`.
4. **Política incompleta** (sin fila, o `max_size_id`/`ppp_allowed` sin contestar) o petición solo
   con `pets` → modo `legacy`: **solo** se valida el número.
5. **Unidad**: hoy una reserva = una unidad; los perros sin `room_id` se asignan a ella (B2.1).
   Un `room_id` distinto → `dog_room_mismatch`.

### Códigos

| Código              | Mensaje (ejemplo)                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `size_not_allowed`  | El tamaño de tu perro «Thor» (25 kg, Grande) no cumple las condiciones de esta opción, que admite hasta «Mediano». Te mostramos otras opciones compatibles en Viajes 4Patas. |
| `ppp_not_allowed`   | Este alojamiento no admite perros PPP («Rocky»). Te mostramos otras opciones compatibles en Viajes 4Patas.                                                                   |
| `too_many_dogs`     | Esta opción admite un máximo de 2 perros. Te mostramos otras opciones compatibles en Viajes 4Patas. (0 → "Esta opción no admite perros…")                                    |
| `dog_room_mismatch` | Todos los perros deben asignarse a la unidad que estás reservando.                                                                                                           |

Nunca se incluyen teléfono, email, WhatsApp ni enlaces de contacto del alojamiento (C2).

Errores de selección (400): `service_not_available`, `service_duplicated`,
`service_requires_dogs`, `extra_not_available`, `extra_duplicated`.

---

## 4. Contratos

### 4.1 `POST /v1/reservations/quote` (público, sin cambios de ruta)

Petición (campos nuevos opcionales):

```json
{
  "site_id": 42,
  "room_id": 3,
  "checkin": "2027-05-10",
  "checkout": "2027-05-13",
  "guests": 2,
  "board_option_id": 5,
  "dogs": [
    { "name": "Luna", "weight_kg": 8, "is_ppp": false },
    { "weight_kg": 18.5, "is_ppp": false, "room_id": 3 }
  ],
  "services": [
    { "type": "dog_supply", "id": 11, "quantity": 1 },
    { "type": "additional_service", "id": 2 }
  ],
  "extras": [{ "id": 21 }]
}
```

- `dogs` (máx. 20): `weight_kg` 0,5–120 (2 decimales), `is_ppp` obligatorio, `name` ≤ 60.
- `pets` (legacy): solo se usa si **no** viene `dogs`; con `dogs` se ignora (`pets = dogs.length`).
- `services[].id` = id de **catálogo** (`dog_supplies.id` / `additional_services.id`);
  `quantity` 1–20 (por defecto 1). `extras[].id` = `room_extras.id`.

Respuesta (campos legacy intactos + nuevos):

```jsonc
{
  "valid": true, "nights": 3, "nightly_rate": 100, "base_subtotal": 300, "board_amount": 45,
  "subtotal": 435, "commission": 0, "total": 435,          // legacy en euros; commission = recargo legacy (0)
  "min_nights": 1, "max_nights": 30, "board_option": {…}, "extras": [/* room_extras */],
  "errors": [],
  "currency": "eur", "pets": 2,
  "price_lines": [
    { "type": "accommodation", "description": "Alojamiento · Suite", "detail": "3 noches × 100,00 €",
      "quantity": 3, "unit_amount_cents": 10000, "amount_cents": 30000,
      "is_optional": false, "is_commissionable": true, "is_penalizable": true }
    // board, dog_supplement, dog_service, additional_service, extra …
  ],
  "totals": { "total_cents": 43500, "mandatory_cents": 43500, "optional_cents": 0, "penalizable_cents": 43500 },
  "compatibility": { "compatible": true, "mode": "policy", "dogs_declared": true, "dog_count": 2,
                     "dogs": [{ "index": 0, "name": "Luna", "weight_kg": 8, "is_ppp": false, "room_id": 3,
                                "size": { "id": 1, "name": "Pequeño", "slug": "pequeno", "rank": 1 } }],
                     "max_size": {…}, "max_size_unlimited": false, "ppp_allowed": false,
                     "limit": { "max": 2, "source": "site_settings" }, "violations": [] },
  "dog_policy": { "complete": true, "max_size": {…}, "max_size_unlimited": false, "ppp_allowed": false,
                  "max_dogs": 2, "supplement_mode": "per_pet_night", "supplement_mode_label": "por perro y noche",
                  "supplement_amount_cents": 1500, "supplement_detail": "2 perros × 3 noches × 15,00 €",
                  "left_alone": "no" },
  "deposit": { "required": true, "amount_cents": 15000, "return_mode": "days", "return_days": 7,
               "charged_by_v4p": false, "message": "Fianza por posibles daños: 150,00 €. …" },
  "available_services": [ { "type": "dog_supply", "id": 11, "name": "Kit de bienvenida", "price_cents": 1200,
                            "pricing_mode": "per_stay", "pricing_mode_label": "por estancia",
                            "estimated_amount_cents": 1200, "estimated_detail": "12,00 € por estancia",
                            "requires_dogs": false, "selected": false, "quantity": 1 } ],
  "available_extras": [ { "id": 21, "name": "Parking", "description": null, "price_cents": 500,
                          "pricing_mode": "per_night", "pricing_mode_label": "por noche",
                          "estimated_amount_cents": 1500, "estimated_detail": "3 noches × 5,00 €", "selected": false } ],
  "selection_issues": [],
  "tourist_tax": null
}
```

La comisión V4P **no** se expone al viajero (A2). Las notas libres de la política (`notes`) no se
devuelven en el presupuesto (pueden contener datos de contacto); sí se guardan en el snapshot.

### 4.2 `POST /v1/reservations/checkout` (público)

Mismo cuerpo que el presupuesto + `guest_name`, `guest_email`, `guest_phone`, `guest_notes?`,
`traveler_token?`. **`user_id` ya no se acepta** (el `ValidationPipe` con `whitelist` lo descarta).

| Resultado                                                                       | HTTP    | Cuerpo                                                                                                                                                    |
| ------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OK                                                                              | 201     | `{ reservation_id, checkout_url, expires_at }` (igual que antes)                                                                                          |
| Solo incompatibilidades de perros                                               | **422** | `{ message: "Tu perro o perros no son compatibles con esta opción.", code: "dogs_incompatible", errors: [...], violations: [...], selection_issues: [] }` |
| Cualquier otro problema (fechas, servicio no disponible, anfitrión sin Stripe…) | 400     | `{ message: "La reserva no es válida.", code: "invalid_reservation", errors, violations, selection_issues }`                                              |
| Noches tomadas en la transacción                                                | 409     | igual que F0                                                                                                                                              |

### 4.3 `traveler_token` (fix de seguridad pendiente de F0)

- PHP (`web/components/reservation_book_wizard.php` → `bookingTravelerToken()` en
  `web/inc/booking_checkout_lib.php`) firma `$_SESSION['user_id']`:
  `v1.{user_id}.{exp}.{hex(HMAC_SHA256("v4p-traveler:v1:{user_id}:{exp}", BOOKING_INTERNAL_KEY))}`,
  validez 12 h. Se entrega en `window.__BOOKING_CHECKOUT_CFG__.travelerToken` (ya no `guestUserId`).
- API (`verifyTravelerToken`, clave `INTERNAL_API_KEY`): firma válida y no caducada (±5 min) →
  `reservations.user_id` y actor `traveler:{id}`; ausente/falsificado/caducado → invitado
  (`user_id = 0`) + warning en log (no bloquea la compra: el id solo se guarda, no da acceso).
- Sin rutas nuevas: la allowlist de rutas públicas de F0 no cambia.

### 4.4 Stripe Checkout

`line_items` = una por línea con importe > 0 (`quantity: 1`, `unit_amount = amount_cents`,
`product_data.name = description`, `product_data.description = detail`). Si hay líneas negativas o
la suma no cuadra → una sola línea con `total_cents` (el importe cobrado nunca cambia).
`payment_intent_data.metadata = { reservation_id, total_cents }`, `transfer_group =
reservation_{id}`, idempotency `checkout:{id}`. Webhook: `amount_total` debe ser igual a
`total_cents` (si no, reembolso automático `amount_mismatch`, F0).

---

## 5. Snapshot v1 ampliado (`reservation_snapshots.payload`)

Se mantiene `schema: 1` y se añaden campos (las filas F1/backfill no cambian). Ejemplo ilustrativo
(los importes de cada bloque son independientes; no suman entre sí):

```jsonc
{
  "schema": 1, "pricing_version": "f2",
  "stay": { "site_id": 42, "checkin": "…", "checkout": "…", "nights": 3, "guests": 2, "pets": 2 },
  "room": {…}, "board": {…}, "currency": "eur", "total_cents": 43500,
  "price_lines": [ /* las mismas líneas insertadas */ ],
  "totals": { "total_cents", "commissionable_cents", "penalizable_cents", "optional_cents", "non_commissionable_cents" },
  "commission": { "rate": 0.12, "cents": 5220, "base": "commissionable", "commissionable_cents": 43500, "penalizable_cents": 43500 },
  "refund_policy": { "rule": "legacy_host_full_refund_until_24h_before_checkin", "window_hours": 24,
                     "refund_deadline": "…Z", "deadline_local_time": "18:00", "timezone": "Europe/Madrid" },
  "timezone": "Europe/Madrid", "source": "checkout",
  "dogs": [ { "index": 0, "name": "Luna", "weight_kg": 8, "is_ppp": false, "room_id": 3,
              "size": { "id": 1, "name": "Pequeño", "slug": "pequeno", "rank": 1 } } ],
  "compatibility": { "mode": "policy", "compatible": true, "dogs_declared": true },
  "dog_policy": {
    "policy_id": 9, "room_id": 3, "species_id": 1, "complete": true,
    "max_size": {…}, "max_size_unlimited": false, "admitted_sizes": [ {…pequeno}, {…mediano} ],
    "ppp_allowed": false, "max_dogs": 2, "max_dogs_source": "site_settings",
    "supplement_mode": "per_pet_night", "supplement_amount_cents": 1500, "supplement_total_cents": 9000,
    "left_alone": "no", "left_alone_conditions": null,
    "common_zones_answered": true, "dining_zones_answered": true,
    "zones": [ { "zone_id": 1, "slug": "terrace", "name": "Terraza", "allows_dining": true, "other_text": null } ],
    "full_unit_access": null,
    "deposit": { "required": true, "amount_cents": 15000, "return_mode": "days", "return_days": 7, "charged_by_v4p": false, "message": "…" },
    "notes": null
  },
  "services": [ { "type": "dog_supply", "id": 11, "name": "Kit de bienvenida", "pricing_mode": "per_stay",
                  "price_cents": 1200, "quantity": 1, "amount_cents": 1200 } ],
  "extras":   [ { "id": 21, "name": "Parking", "pricing_mode": "per_night", "price_cents": 500, "amount_cents": 1500 } ],
  "deposit": { …igual que dog_policy.deposit },
  "tourist_tax": null
}
```

- Regla de cancelación vigente: la de F0/F1 (reembolso total del anfitrión hasta 24 h antes,
  `REFUND_WINDOW`) hasta F3.
- Zona horaria: `platform_settings.default_timezone` (los sites no tienen zona propia aún).
- C7: el payload es una copia profunda (`structuredClone`); el pago posterior no recalcula nada.
  Test: `f2-checkout-flows.test.ts` › "C7: later host policy changes never alter a booked reservation".
- `reservations.extras_snapshot` (JSON legacy para PHP) = `{ services, extras }`.
- Columnas legacy: `subtotal = total = total_cents / 100`, `commission = 0`, `pets = nº de perros`.

---

## 6. Cambios de UI

**El checkout vivo es la app React `booking-frontend`** (montada por
`web/components/reservation_book_wizard.php` con `web/react/booking/` generado por
`pnpm run build:php`). `web/js/booking_reservation_checkout.js` **no se carga en ninguna página**
(código muerto); solo se adaptó para no enviar `user_id`.

| Paso                   | Cambio                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2 · Fechas y huéspedes | El contador de mascotas se sustituye por **Tus perros**: añadir/quitar perro, nombre (opcional), peso (kg, admite coma), PPP Sí/No. Se muestra el tamaño derivado, la ficha de la política (tamaño máximo, PPP, máximo de perros, suplemento) y la **compatibilidad en vivo** (presupuesto con debounce): verde si es compatible; si no, un único bloque con todas las incompatibilidades. Nota informativa de **perros de asistencia**. |
| 3 · Resumen            | Selección de **servicios para perros, servicios adicionales y extras** de pago (precio + modo explicado + estimación para la estancia, cantidad). Cada cambio recalcula el presupuesto. **Desglose por líneas** y total. **Caja de fianza** ("La fianza la gestiona el alojamiento; no se cobra en Viajes 4Patas").                                                                                                                      |
| Resumen lateral        | Desglose por líneas (si la API lo devuelve) y fianza.                                                                                                                                                                                                                                                                                                                                                                                    |
| Pago                   | Envía `dogs`, `services`, `extras` y `traveler_token`; nunca `user_id`.                                                                                                                                                                                                                                                                                                                                                                  |

Textos: claves `jvariables1` nuevas (página `reserva_checkout`), todas con fallback en español en
`reservation_book_wizard.php`: `nrf_dogs_title`, `nrf_dogs_hint`, `nrf_dogs_none`, `nrf_dog_add`,
`nrf_dog_remove`, `nrf_dog_name`, `nrf_dog_weight`, `nrf_dog_ppp`, `nrf_dog_ppp_yes`,
`nrf_dog_ppp_no`, `nrf_dog_label`, `nrf_dog_weight_invalid`, `nrf_dogs_compatible_title`,
`nrf_dogs_incompatible_title`, `nrf_dog_policy_max_size`, `nrf_dog_policy_no_weight_limit`,
`nrf_dog_policy_ppp`, `nrf_dog_policy_max_dogs`, `nrf_dog_policy_unlimited`,
`nrf_dog_policy_supplement`, `nrf_dog_policy_free`, `nrf_assistance_dog_title`,
`nrf_assistance_dog_note`, `nrf_services_title`, `nrf_services_hint`, `nrf_services_dog_group`,
`nrf_services_additional_group`, `nrf_services_extras_group`, `nrf_services_quantity`,
`nrf_services_requires_dogs`, `nrf_breakdown_title`, `nrf_breakdown_optional`,
`nrf_deposit_title`, `nrf_deposit_note`.

**Emails de confirmación**: Nest (`ReservationEmailService.sendPaymentConfirmedEmails` lee el
último snapshot) añade perros declarados, desglose por líneas, total pagado y fianza al email del
viajero y del anfitrión. PHP (`inc/booking_reservation_email_lib.php`) pinta el mismo bloque si el
payload trae `price_lines` / `deposit` (claves opcionales; reservas legacy sin cambios).

---

## 7. Cómo probar

### Automático

```bash
npx vitest run --config vitest.config.unit.ts
```

Nuevos:

- `tests/unit/contexts/payments/reservation-pricing.test.ts`: todos los modos de suplemento,
  servicios y extras; flags; total = Σ líneas; comisión half-up (12 % × 100,05 € = 12,01 €); la
  base comisionable excluye la tasa turística; presupuesto = checkout; fianza fuera del total;
  `line_items` de Stripe (suma = total, _fallback_ con líneas negativas o descuadre).
- `tests/unit/contexts/pet-policies/dog-compatibility.test.ts`: peso → tamaño en los límites,
  tamaños acumulativos, XL sin límite, PPP, número, ilimitado, todas las violaciones juntas y sin
  datos de contacto, legacy (sin settings → `rooms.max_pets`, política incompleta, solo `pets`).
- `tests/unit/contexts/payments/f2-checkout-flows.test.ts` (BD en memoria + servicios reales F1):
  líneas/comisión/snapshot F2 en el checkout; **C7** (cambiar la política tras reservar no altera
  snapshot ni líneas; un presupuesto nuevo sí aplica la nueva); 422 con todas las violaciones y sin
  reserva; 400 legacy; `traveler_token` válido / falsificado / caducado / basura y `user_id`
  ignorado; webhook acepta exactamente `total_cents` y reembolsa otro importe; la sesión de Stripe
  lleva una `line_item` por línea con suma = `total_cents`, metadata y `transfer_group`.

### Manual (ejemplo con números)

Datos: habitación 100 €/noche, media pensión 15 €/noche, política de la unidad "hasta Mediano, sin
PPP, 15 € por perro y noche, fianza 150 € a 7 días", `site_settings.max_pets = 2`, kit de
bienvenida de pago 12 € por estancia.

```bash
curl -s localhost:3000/v1/reservations/quote -H 'Content-Type: application/json' -d '{
  "site_id":42,"room_id":3,"checkin":"2027-05-10","checkout":"2027-05-13","guests":2,"board_option_id":5,
  "dogs":[{"name":"Luna","weight_kg":8,"is_ppp":false},{"weight_kg":18,"is_ppp":false}],
  "services":[{"type":"dog_supply","id":11}]}' | jq '.price_lines[] | [.type,.amount_cents]', .totals
```

Esperado: alojamiento 30000 + régimen 4500 + suplemento 9000 (15 × 2 × 3) + kit 1200 =
**44700** céntimos (447,00 €); `commission_cents` en la reserva = 5364 (12 %).

- Perro de 25 kg o PPP o 3 perros → `valid:false` y `compatibility.violations` con
  `size_not_allowed` / `ppp_not_allowed` / `too_many_dogs`; el checkout responde 422.
- Sin `dogs` y `pets: 1` → modo `legacy`, sin suplemento por tamaño/PPP, solo número.

Tras pagar con `4242…`:

```sql
SELECT total_cents, commission_cents, pets, user_id, extras_snapshot FROM reservations ORDER BY id DESC LIMIT 1;
SELECT type, quantity, unit_amount_cents, amount_cents, is_optional, is_commissionable, is_penalizable
  FROM reservation_price_lines WHERE reservation_id = ?;
SELECT JSON_EXTRACT(payload,'$.dog_policy'), JSON_EXTRACT(payload,'$.dogs') FROM reservation_snapshots WHERE reservation_id = ?;
```

En el Dashboard de Stripe la sesión muestra 4 líneas (alojamiento, régimen, suplemento, kit).
C7 manual: cambiar después `unit_pet_policies.supplement_mode` → el snapshot y las líneas de la
reserva no cambian; un presupuesto nuevo sí refleja el cambio.

Seguridad: logueado como viajero, manipular `window.__BOOKING_CHECKOUT_CFG__.travelerToken` →
la reserva queda con `user_id = 0` y warning `traveler_token rejected (bad_signature)`.

> La UI React necesita recompilar `booking-frontend` (`pnpm run build:php`) para verse en
> `localhost:5173`; no se ha ejecutado ningún build.

---

## 8. Configuración

- **Sin variables de entorno nuevas.** `INTERNAL_API_KEY` (booking) = `BOOKING_INTERNAL_KEY` (web)
  ahora también firma el `traveler_token` (comentario añadido en `.env.example`).
- `platform_settings` sin claves nuevas (`commission_rate`, `default_timezone`,
  `deadline_local_time` de F1).
- Constantes en código: validez del token 12 h (PHP), tolerancia de reloj 5 min, peso 0,5–120 kg,
  máx. 20 perros / 30 servicios por petición, cantidad de servicio 1–20.

---

## 9. Riesgos / limitaciones

- **Perros de asistencia**: solo nota informativa; no hay flag ni _bypass_ del suplemento hasta la
  validación legal (C4).
- **Multi-unidad**: el modelo de reserva es de una unidad; `room_id` por perro solo se valida contra
  ella. El cálculo por unidad (C5) ya es por `roomId` y está preparado para varias.
- **Payout con reembolso parcial** (`computePlatformFee`): sigue usando `rate × importe neto
retenido`; cuando existan líneas no comisionables (tasa turística) hay que restarlas → F3.
- Columna legacy `subtotal` = total con extras: el listado del anfitrión calcula
  `base_subtotal = subtotal − régimen`, que ahora incluye suplemento/servicios (cosmético).
- El presupuesto público consulta ahora 6 tablas más (sin caché); vigilar carga.
- `traveler_token` inválido no bloquea la compra (se reserva como invitado): decisión consciente,
  el id no otorga acceso.
- La UI React no se ha compilado ni probado en navegador (regla "no build").

## 10. Pendiente para F3

- Penalizaciones por cancelación del viajero sobre la **base penalizable** y reembolso íntegro de
  opcionales (A4/A11), con comisión sobre lo retenido.
- Deadline exacto 18:00 hora local (A6) mostrado en checkout/confirmación y política de cancelación
  por tarifa (sustituye `REFUND_WINDOW`).
- Reserva flexible / `method_validated` / regularización 12 h (A5/A7).
- Flujo de perro de asistencia (B4) tras validación jurídica.

## 11. Preguntas abiertas para el cliente

1. **Tasa turística**: ¿quién la configura (anfitrión por persona/noche, por municipio…)? ¿Se cobra
   en V4P o in situ? ¿Exenciones (menores)? Hoy no se cobra.
2. **Obligatorio vs. opcional**: ¿algún servicio del anfitrión debe ser obligatorio (p. ej.
   limpieza obligatoria, A3 "Limpieza / suplemento obligatorio")? Hoy todos los servicios/extras
   seleccionables son opcionales y no penalizables; solo alojamiento, régimen y suplemento de perro
   son obligatorios.
3. ¿El régimen elegido es siempre obligatorio/penalizable o hay pensiones "opcionales" (A3
   "Restauración / media pensión opcional")?
4. ¿Algún extra opcional con condiciones de cancelación propias (A4, excepción)?
5. ¿Tope de unidades por servicio (hoy 20) y stock del kit de bienvenida (A2.2)?
6. ¿Mostrar en la ficha alternativas compatibles (C3) cuando hay incompatibilidad?
