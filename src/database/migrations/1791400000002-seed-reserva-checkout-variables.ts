import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Wizard de reserva PHP (/reservar/{id}-{alias}, sustituye a la app React
// booking-frontend, deprecada): textos nrf_* de la página jvariables 'reserva_checkout' (pasos, calendario,
// perros/compatibilidad F2, servicios/extras, desglose, fianza, condiciones y errores). Hasta ahora solo existían
// como texto por defecto en PHP; la fuente de verdad del mapa es web/inc/reservation_book_texts.php.
// Same approach as SeedIncidenciasVariables1791400000001: the page is created if missing, existing variables are
// skipped; down deletes only these keys. Only description_l1 exists in v4p_jvariables1; other languages come from
// jclientes_translations. Placeholders ({n}, {nights}, {from}, {to}) are replaced by js/reservation_book.js.
const CUSTOMER = 'v4p';

/** [variable, description_l1, link?] — link is stored as-is (PHP prefixes $hostId when relative). */
type SeedVariable = readonly [variable: string, text: string, link?: string];

interface SeedPage {
    page: string;
    variables: readonly SeedVariable[];
}

const RESERVA_CHECKOUT_VARIABLES: readonly SeedVariable[] = [
    ['nrf_book_seo_title', 'Reservar alojamiento'],
    ['nrf_book_seo_desc', 'Reserva online tu alojamiento que admite perros.'],
    ['nrf_book_unavailable_title', 'Reserva no disponible'],
    ['nrf_book_unavailable_desc', 'Este alojamiento no admite reservas online en este momento.'],
    ['nrf_success_home_btn', 'Volver al inicio'],
    ['nrf_form_title', 'Crea tu reservación'],
    ['nrf_back_to_site', 'Volver al alojamiento'],
    ['nrf_host_unavailable', 'Las reservas online no están disponibles temporalmente para este alojamiento.'],
    ['nrf_js_required', 'Activa JavaScript en tu navegador para completar la reserva.'],
    ['nrf_err_generic', 'No se pudo completar la operación. Inténtalo de nuevo.'],
    ['nrf_err_guest_data', 'Completa nombre, email y teléfono válidos.'],
    ['nrf_err_dates', 'Selecciona fechas de entrada y salida válidas.'],
    ['nrf_err_unavailable', 'No hay disponibilidad para las fechas seleccionadas.'],
    ['nrf_err_min_nights', 'La estancia no cumple el mínimo de noches.'],
    ['nrf_err_max_nights', 'La estancia supera el máximo de noches.'],
    ['nrf_err_host_not_ready', 'El anfitrión aún no puede recibir pagos.'],
    ['nrf_err_no_rooms', 'Selecciona una habitación.'],
    ['nrf_err_guests_max', 'Esta opción admite como máximo {n} huéspedes.'],
    ['nrf_err_dogs_max', 'Puedes indicar hasta {n} perros.'],
    ['nrf_err_terms', 'Debes aceptar las condiciones de reserva para continuar.'],
    ['nrf_err_session', 'Tu sesión ha caducado. Recarga la página para continuar.'],
    ['nrf_err_quote_invalid', 'Revisa los datos de la reserva antes de continuar.'],
    ['nrf_room_label', 'Habitación'],
    ['nrf_room_per_night', '/noche'],
    ['nrf_room_guests_meta', 'huésp.'],
    ['nrf_room_dogs_meta', 'perros'],
    ['nrf_board_title', 'Régimen alimenticio'],
    ['nrf_board_included', 'Incluido'],
    ['nrf_board_per_night', 'por noche'],
    ['nrf_board_room_only', 'Solo alojamiento'],
    ['nrf_board_breakfast_included', 'Desayuno incluido'],
    ['nrf_board_half_board', 'Media pensión'],
    ['nrf_board_full_board', 'Pensión completa'],
    ['nrf_board_all_inclusive', 'Todo incluido'],
    ['nrf_review_board', 'Pensión'],
    ['nrf_cal_legend_available', 'Disponible'],
    ['nrf_cal_legend_reserved', 'Ocupado'],
    ['nrf_cal_legend_blocked', 'Bloqueado'],
    ['nrf_cal_legend_closed', 'Cerrado'],
    ['nrf_cal_legend_empty', 'Sin tarifa'],
    ['nrf_cal_pick_checkin', 'Elige la fecha de entrada'],
    ['nrf_cal_pick_checkout', 'Elige la fecha de salida'],
    ['nrf_cal_range_summary', '{nights} noches · {from} – {to}'],
    ['nrf_cal_loading', 'Cargando calendario…'],
    ['nrf_cal_no_room', 'Selecciona una habitación primero'],
    ['nrf_cal_invalid_range', 'El rango seleccionado no está disponible'],
    ['nrf_cal_prev_month', 'Mes anterior'],
    ['nrf_cal_next_month', 'Mes siguiente'],
    ['nrf_cal_week_mon', 'L'],
    ['nrf_cal_week_tue', 'M'],
    ['nrf_cal_week_wed', 'X'],
    ['nrf_cal_week_thu', 'J'],
    ['nrf_cal_week_fri', 'V'],
    ['nrf_cal_week_sat', 'S'],
    ['nrf_cal_week_sun', 'D'],
    ['nrf_cal_dates_label', 'Fechas de estancia'],
    ['nrf_cal_clear', 'Borrar fechas'],
    ['nrf_step_room', 'Habitación'],
    ['nrf_step_dates', 'Fechas'],
    ['nrf_step_summary', 'Resumen'],
    ['nrf_step_guest', 'Datos'],
    ['nrf_step_payment', 'Pago'],
    ['nrf_steps_nav_label', 'Pasos de la reserva'],
    ['nrf_step1_title', 'Elige tu habitación'],
    ['nrf_step1_hint', 'Selecciona el espacio ideal para ti y tus mascotas'],
    ['nrf_step2_title', 'Fechas y huéspedes'],
    ['nrf_step2_hint', 'Indica cuándo llegas y cuántos viajáis'],
    ['nrf_step3_title', 'Confirma tu reserva'],
    ['nrf_step3_hint', 'Revisa el resumen antes de continuar'],
    ['nrf_step4_title', 'Tus datos de contacto'],
    ['nrf_step4_hint', 'Necesitamos esta información para confirmar la reserva'],
    ['nrf_step5_title', 'Pago seguro'],
    ['nrf_step5_hint', 'Completa el pago con Stripe'],
    ['nrf_btn_pay', 'Pagar ahora'],
    ['nrf_btn_continue', 'Continuar'],
    ['nrf_btn_back', 'Atrás'],
    ['nrf_loading', 'Procesando…'],
    ['nrf_quote_loading', 'Calculando precio…'],
    ['nrf_payment_redirecting', 'Te estamos redirigiendo a Stripe…'],
    ['nrf_checkin', 'Entrada'],
    ['nrf_checkout', 'Salida'],
    ['nrf_guests', 'Huéspedes'],
    ['nrf_name', 'Nombre completo'],
    ['nrf_email', 'Correo electrónico'],
    ['nrf_phone', 'Teléfono'],
    ['nrf_notes', 'Observaciones (opcional)'],
    ['nrf_notes_placeholder', 'Cuéntanos algo sobre tu estancia'],
    ['nrf_terms_accept', 'He leído y acepto las'],
    ['nrf_terms_link', 'condiciones de reserva y la política de privacidad'],
    ['nrf_nights_label', 'Noches'],
    ['nrf_total_label', 'Total'],
    ['nrf_payment_intro', 'Serás redirigido a Stripe para completar el pago de forma segura.'],
    ['nrf_order_summary_title', 'Resumen de tu reservación'],
    ['nrf_order_summary_secure_title', 'Reservación segura'],
    ['nrf_order_summary_secure_desc', 'Pago protegido con Stripe'],
    ['nrf_pet_friendly_badge', 'Pet-friendly'],
    ['nrf_dogs_title', 'Tus perros'],
    ['nrf_dogs_hint', 'Indica el peso de cada perro: calculamos su tamaño y comprobamos que esta opción lo admite.'],
    ['nrf_dogs_none', 'Viajas sin perro.'],
    ['nrf_dog_add', 'Añadir perro'],
    ['nrf_dog_remove', 'Quitar'],
    ['nrf_dog_name', 'Nombre (opcional)'],
    ['nrf_dog_weight', 'Peso (kg)'],
    ['nrf_dog_ppp', '¿Es PPP?'],
    ['nrf_dog_ppp_yes', 'Sí'],
    ['nrf_dog_ppp_no', 'No'],
    ['nrf_dog_label', 'Perro'],
    ['nrf_dog_size', 'Tamaño'],
    ['nrf_dog_weight_invalid', 'Indica un peso entre 0,5 y 120 kg.'],
    ['nrf_saved_dogs_title', 'Tus perros guardados'],
    ['nrf_saved_dogs_hint', 'Pulsa en un perro para añadirlo a la reserva.'],
    ['nrf_dogs_compatible_title', 'Tus perros son compatibles con esta opción.'],
    ['nrf_dogs_incompatible_title', 'Esta opción no es compatible con tus perros'],
    ['nrf_dog_policy_max_size', 'Tamaño máximo admitido'],
    ['nrf_dog_policy_no_weight_limit', 'Sin límite de peso'],
    ['nrf_dog_policy_ppp', 'Perros PPP'],
    ['nrf_dog_policy_max_dogs', 'Máximo de perros'],
    ['nrf_dog_policy_unlimited', 'Sin límite'],
    ['nrf_dog_policy_supplement', 'Suplemento por perro'],
    ['nrf_dog_policy_free', 'Perros gratis'],
    ['nrf_assistance_dog_title', 'Perros de asistencia'],
    ['nrf_assistance_dog_note', 'Los perros de asistencia legalmente reconocidos están sujetos a normativa específica y se gestionarán mediante un flujo diferenciado. No se aplicará el suplemento por mascota cuando legalmente no corresponda.'],
    ['nrf_services_title', 'Servicios y extras opcionales'],
    ['nrf_services_hint', 'Añádelos ahora y se incluirán en el pago. Si cancelas, los servicios opcionales no prestados se reembolsan íntegramente.'],
    ['nrf_services_dog_group', 'Para tu perro'],
    ['nrf_services_additional_group', 'Servicios adicionales'],
    ['nrf_services_extras_group', 'Extras del alojamiento'],
    ['nrf_services_quantity', 'Cantidad'],
    ['nrf_services_requires_dogs', 'Se cobra por perro: añade al menos un perro.'],
    ['nrf_breakdown_title', 'Desglose del precio'],
    ['nrf_breakdown_optional', 'opcional'],
    ['nrf_deposit_title', 'Fianza por posibles daños'],
    ['nrf_deposit_note', 'La fianza la gestiona el alojamiento; no se cobra en Viajes 4Patas.'],
];

const PAGES: readonly SeedPage[] = [
    { page: 'reserva_checkout', variables: RESERVA_CHECKOUT_VARIABLES },
];

export class SeedReservaCheckoutVariables1791400000002 implements MigrationInterface {
    name = 'SeedReservaCheckoutVariables1791400000002'

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

        for (const [variable, text, link] of variables) {
            if (existingKeys.has(variable)) {
                continue;
            }
            sequence += 10;
            await queryRunner.query(
                `INSERT INTO \`v4p_jvariables1\` (\`customer\`, \`idback\`, \`sequence\`, \`variable\`, \`description_l1\`, \`link\`) VALUES (?, ?, ?, ?, ?, ?)`,
                [CUSTOMER, String(pageId), sequence, variable, text, link ?? ''],
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
