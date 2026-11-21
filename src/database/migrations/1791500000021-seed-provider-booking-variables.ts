import { MigrationInterface, QueryRunner } from 'typeorm';

// Hand-written, idempotent. Textos de la reserva inmediata con proveedor externo (Nuitee, plan fase 3-4 web):
//   - página jvariables 'alojamiento': caja "Reserva inmediata" de la ficha (components/provider_book_box.php +
//     js/provider_book.js, claves prv_*; inc/provider_book_texts.php tiene los mismos textos por defecto);
//   - página 'reserva_checkout': estados de la página de éxito para reservas source = nuitee
//     (php/reservation_success_body.php + js/booking_reservation_success.js).
// Igual que SeedFinalizeStayVariables1791500000013: crea la página si falta y nunca pisa variables existentes.
const CUSTOMER = 'v4p';

/** [variable, description_l1] */
type SeedVariable = readonly [variable: string, text: string];

interface SeedPage {
    page: string;
    variables: readonly SeedVariable[];
}

const SITE_VARIABLES: readonly SeedVariable[] = [
    ['prv_badge', 'Reserva inmediata'],
    ['prv_title', 'Reserva inmediata'],
    ['prv_subtitle', 'Precio y disponibilidad en tiempo real. Pago seguro.'],
    ['prv_checkin', 'Entrada'],
    ['prv_checkout', 'Salida'],
    ['prv_adults', 'Adultos'],
    ['prv_children', 'Niños'],
    ['prv_child_age', 'Edad del niño {n}'],
    ['prv_dogs', 'Perros'],
    ['prv_dog_name', 'Nombre (opcional)'],
    ['prv_dog_weight', 'Peso (kg)'],
    ['prv_dog_ppp', 'Raza PPP'],
    ['prv_search_btn', 'Ver disponibilidad'],
    ['prv_loading', 'Buscando tarifas…'],
    ['prv_no_availability', 'Sin disponibilidad para esas fechas. Prueba con otras fechas.'],
    ['prv_pets_not_allowed', 'Este alojamiento no admite perros para esta estancia.'],
    ['prv_rates_unavailable', 'No hemos podido consultar la disponibilidad. Inténtalo de nuevo en unos minutos.'],
    ['prv_night', '1 noche'],
    ['prv_nights', '{n} noches'],
    ['prv_total', 'Total'],
    ['prv_max_occupancy', 'Hasta {n} personas'],
    ['prv_free_cancel_until', 'Cancelación gratuita hasta el {date} a las {time} ({zone})'],
    ['prv_non_refundable', 'No reembolsable'],
    ['prv_cancel_from', 'Desde el {date} a las {time}: {amount}'],
    ['prv_taxes_at_hotel', 'A pagar en el hotel: {items}'],
    ['prv_tz_hotel', 'hora del hotel'],
    ['prv_pet_policy_title', 'Política de mascotas del hotel'],
    ['prv_pet_fee', 'Suplemento por mascota: {amount} {basis}'],
    ['prv_pet_fee_free', 'Sin suplemento por mascota'],
    ['prv_pet_weight', 'Peso máximo: {value}'],
    ['prv_dogs_not_guaranteed', 'Comunicaremos tus perros al hotel. La petición no está garantizada: se aplica la política de mascotas del hotel.'],
    ['prv_select_btn', 'Reservar'],
    ['prv_guest_title', 'Datos del titular'],
    ['prv_first_name', 'Nombre'],
    ['prv_last_name', 'Apellidos'],
    ['prv_email', 'Email'],
    ['prv_phone', 'Teléfono'],
    ['prv_notes', 'Comentarios para el hotel (opcional)'],
    ['prv_accept_terms', 'Acepto las condiciones de la reserva y la política de cancelación.'],
    ['prv_pay_btn', 'Ir al pago'],
    ['prv_back_btn', 'Cambiar tarifa'],
    ['prv_reconfirm_title', 'La tarifa ha cambiado'],
    ['prv_change_price', 'Nuevo precio total: {amount}'],
    ['prv_change_cancellation', 'Han cambiado las condiciones de cancelación.'],
    ['prv_change_board', 'Ha cambiado el régimen de comidas.'],
    ['prv_reconfirm_btn', 'Aceptar y continuar'],
    ['prv_login_required', 'Inicia sesión para reservar.'],
    ['prv_login_email', 'Email'],
    ['prv_login_password', 'Contraseña'],
    ['prv_login_btn', 'Iniciar sesión'],
    ['prv_register_link', '¿No tienes cuenta? Regístrate'],
    ['prv_login_error', 'Email o contraseña incorrectos.'],
    ['prv_error_generic', 'No hemos podido completar la reserva. Inténtalo de nuevo.'],
    ['prv_offer_unavailable', 'Esta tarifa ya no está disponible. Vuelve a buscar disponibilidad.'],
    ['prv_reservation_expired', 'La reserva ha caducado. Vuelve a buscar disponibilidad.'],
    ['prv_invalid_dates', 'Revisa las fechas de entrada y salida.'],
    ['prv_invalid_guest', 'Revisa los datos del titular.'],
    ['prv_invalid_dogs', 'Indica el peso de cada perro (entre 0,5 y 120 kg).'],
    ['prv_terms_required', 'Debes aceptar las condiciones.'],
    ['prv_redirecting', 'Redirigiendo al pago seguro…'],
];

const SUCCESS_VARIABLES: readonly SeedVariable[] = [
    ['nrf_success_provider_pending_title', 'Estamos confirmando tu reserva'],
    ['nrf_success_provider_pending', 'Tu tarjeta está autorizada, pero aún no se ha cobrado. Estamos confirmando la reserva con el hotel; suele tardar menos de un minuto.'],
    ['nrf_success_provider_confirmed', '¡El hotel ha confirmado tu reserva! Te hemos enviado la confirmación por email.'],
    ['nrf_success_provider_failed_title', 'No se ha podido confirmar la reserva'],
    ['nrf_success_provider_failed', 'El hotel no ha podido confirmar la reserva. No se te cobrará nada: la autorización de tu tarjeta se anulará. Te hemos enviado un email con alternativas.'],
    ['nrf_success_provider_timeout', 'La confirmación del hotel está tardando más de lo normal. Te avisaremos por email en cuanto la tengamos; si no se confirma, no se cobrará nada.'],
];

const PAGES: readonly SeedPage[] = [
    { page: 'alojamiento', variables: SITE_VARIABLES },
    { page: 'reserva_checkout', variables: SUCCESS_VARIABLES },
];

export class SeedProviderBookingVariables1791500000021 implements MigrationInterface {
    name = 'SeedProviderBookingVariables1791500000021'

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const { page, variables } of PAGES) {
            const pageId = await this.ensurePage(queryRunner, page);
            await this.insertMissing(queryRunner, pageId, variables);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const { page, variables } of PAGES) {
            const pageId = await this.findPageId(queryRunner, page);
            if (pageId === undefined) {
                continue;
            }
            // All keys are new (prv_* / nrf_success_provider_*): safe to remove.
            await queryRunner.query(
                `DELETE FROM \`v4p_jvariables1\` WHERE \`customer\` = ? AND \`idback\` = ? AND \`variable\` IN (?)`,
                [CUSTOMER, String(pageId), variables.map(([variable]) => variable)],
            );
        }
    }

    private async ensurePage(queryRunner: QueryRunner, page: string): Promise<number> {
        let pageId = await this.findPageId(queryRunner, page);
        if (pageId === undefined) {
            const [{ next_sequence }] = await queryRunner.query(
                `SELECT COALESCE(MAX(\`sequence\`), 0) + 10 AS next_sequence FROM \`v4p_jvariables0\` WHERE \`customer\` = ?`,
                [CUSTOMER],
            ) as { next_sequence: number | string }[];
            await queryRunner.query(
                `INSERT INTO \`v4p_jvariables0\` (\`customer\`, \`sequence\`, \`pagina\`, \`seocaption_l1\`, \`seodescription_l1\`) VALUES (?, ?, ?, '-', '-')`,
                [CUSTOMER, Number(next_sequence), page],
            );
            pageId = await this.findPageId(queryRunner, page);
        }
        if (pageId === undefined) {
            throw new Error(`could not create v4p_jvariables0 row for pagina=${page}`);
        }
        return pageId;
    }

    private async insertMissing(queryRunner: QueryRunner, pageId: number, variables: readonly SeedVariable[]): Promise<void> {
        const existing = await queryRunner.query(
            `SELECT \`variable\`, \`sequence\` FROM \`v4p_jvariables1\` WHERE \`customer\` = ? AND \`idback\` = ?`,
            [CUSTOMER, String(pageId)],
        ) as { variable: string; sequence: number | null }[];
        const existingKeys = new Set(existing.map(row => row.variable));
        let sequence = Math.max(0, ...existing.map(row => Number(row.sequence ?? 0)));

        for (const [variable, text] of variables) {
            if (existingKeys.has(variable)) {
                continue;
            }
            sequence += 10;
            await queryRunner.query(
                `INSERT INTO \`v4p_jvariables1\` (\`customer\`, \`idback\`, \`sequence\`, \`variable\`, \`description_l1\`, \`link\`) VALUES (?, ?, ?, ?, ?, '')`,
                [CUSTOMER, String(pageId), sequence, variable, text],
            );
        }
    }

    private async findPageId(queryRunner: QueryRunner, page: string): Promise<number | undefined> {
        const rows = await queryRunner.query(
            `SELECT \`id\` FROM \`v4p_jvariables0\` WHERE \`customer\` = ? AND \`pagina\` = ? ORDER BY \`id\` LIMIT 1`,
            [CUSTOMER, page],
        ) as { id: number }[];
        const [first] = rows as ({ id: number } | undefined)[];
        return first === undefined ? undefined : Number(first.id);
    }
}
