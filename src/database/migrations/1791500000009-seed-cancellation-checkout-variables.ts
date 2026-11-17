import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Fase 5 (tarifas de cancelación + cobro diferido): textos del checkout y de la
// página de éxito (página 'reserva_checkout', nrf_*) y del panel del viajero / confirmación imprimible
// (página 'cuenta_viajero', cv_*). Same approach as SeedIncidentsTabVariables1791400000012: the page is created
// if missing, existing variables are skipped; down deletes only these keys, never the page.
// Only description_l1 exists in v4p_jvariables1; other languages come from jclientes_translations.
// PHP/JS keep these same Spanish fallbacks while this seed has not run.
const CUSTOMER = 'v4p';

/** [variable, description_l1, link?] — link is stored as-is (PHP prefixes $hostIdLang when relative). */
type SeedVariable = readonly [variable: string, text: string, link?: string];

interface SeedPage {
    page: string;
    variables: readonly SeedVariable[];
}

// {amount} {date} {time} {zone} {tz} los sustituye js/reservation_book.js / js/booking_reservation_success.js.
const RESERVA_CHECKOUT_VARIABLES: readonly SeedVariable[] = [
    ['nrf_cancel_policy_title', 'Política de cancelación'],
    ['nrf_cancel_charge_flexible', 'Hoy no se cobra nada. Se cobrarán {amount} el {date} a las {time} ({zone}).'],
    ['nrf_cancel_charge_now', 'Al confirmar la reserva se cobra el 100 % del importe ({amount}).'],
    ['nrf_cancel_last_minute', 'Esta reserva ya no tiene cancelación gratuita.'],
    ['nrf_cancel_tz_madrid', 'hora de Madrid'],
    ['nrf_cancel_tz_canarias', 'hora de Canarias'],
    ['nrf_cancel_tz_other', 'hora local: {tz}'],
    ['nrf_btn_save_card', 'Guardar tarjeta y confirmar'],
    ['nrf_payment_intro_flexible', 'Serás redirigido a Stripe para guardar tu tarjeta de forma segura. Hoy no se cobra nada.'],
    ['nrf_success_charge_flexible', 'Hoy no se ha cobrado nada. Se cobrarán {amount} el {date} a las {time} ({zone}).'],
];

// {fecha} {importe} {tz} los sustituyen js/traveler_account.js, js/traveler_reservations.js y
// php/reservation_confirmation_body.php.
const CUENTA_VIAJERO_VARIABLES: readonly SeedVariable[] = [
    ['cv_tz_madrid', 'hora de Madrid'],
    ['cv_tz_canarias', 'hora de Canarias'],
    ['cv_tz_other', 'hora local: {tz}'],
    ['cv_det_cobro_programado', 'Cobro programado'],
    ['cv_det_cobro_programado_valor', '{importe} el {fecha}. Hasta entonces no se te cobra nada.'],
    ['cv_det_pago_pendiente', 'Pago pendiente'],
    ['cv_det_pago_pendiente_hasta', 'Paga la reserva antes del {fecha} o se cancelará.'],
    ['cv_cancel_preview_cobro_penalizacion', 'Se te cobrará {importe} de penalización con la tarjeta que guardaste al reservar.'],
    ['cv_cancel_preview_gratis_sin_cobro', 'Cancelación gratuita: no se te cobrará nada.'],
    ['cv_cancel_preview_diferido_revision', 'No se te cobrará nada ahora: el equipo de Viajes 4 Patas revisará la cancelación y te informará.'],
];

const PAGES: readonly SeedPage[] = [
    { page: 'reserva_checkout', variables: RESERVA_CHECKOUT_VARIABLES },
    { page: 'cuenta_viajero', variables: CUENTA_VIAJERO_VARIABLES },
];

export class SeedCancellationCheckoutVariables1791500000009 implements MigrationInterface {
    name = 'SeedCancellationCheckoutVariables1791500000009'

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
