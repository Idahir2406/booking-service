import { MigrationInterface, QueryRunner } from 'typeorm';

// Hand-written, idempotent. "Comunicar imposibilidad de alojar" (2026-11-15,
// ReservationHostCannotHostService): the host action opens a V4P review and never cancels by itself.
// 1. reservation_incidents.type enum gains 'host_cannot_host'.
// 2. Texts: host tab Reservas (página 'cuenta': button, modal, reasons, pending badge) and the traveler
//    panel label (página 'cuenta_viajero', cv_inc_type_*; visible once V4P involves the traveler).
// down: removes the texts and restores the enum (fails while host_cannot_host rows exist, on purpose).
const CUSTOMER = 'v4p';

const ENUM_WITH =
    "'before_arrival','during_stay','dog_issue','conditions_not_respected','charge_issue','refund_issue','force_majeure_cancellation','no_show','host_cannot_host','other'";
const ENUM_WITHOUT =
    "'before_arrival','during_stay','dog_issue','conditions_not_respected','charge_issue','refund_issue','force_majeure_cancellation','no_show','other'";

/** [variable, description_l1, link?] */
type SeedVariable = readonly [variable: string, text: string, link?: string];

interface SeedPage {
    page: string;
    variables: readonly SeedVariable[];
}

const HOST_VARIABLES: readonly SeedVariable[] = [
    ['tab_reservas_btn_cannot_host', 'Comunicar imposibilidad de alojar'],
    ['tab_reservas_modal_cannot_host_title', 'Comunicar imposibilidad de alojar'],
    ['tab_reservas_modal_cannot_host_desc', 'La reserva NO se cancela automáticamente. El equipo de viajes4patas revisará tu aviso, contactará con el viajero y te confirmará la resolución. Mientras tanto, el pago de esta reserva queda bloqueado.'],
    ['tab_reservas_modal_cannot_host_reason', 'Motivo'],
    ['tab_reservas_modal_cannot_host_description', 'Explica qué ha pasado (obligatorio si eliges «Otro motivo»)'],
    ['tab_reservas_modal_cannot_host_confirm', 'Enviar aviso a viajes4patas'],
    ['tab_reservas_modal_cannot_host_required', 'Elige un motivo y, si es «Otro motivo», explica qué ha pasado.'],
    ['tab_reservas_cannot_host_sent', 'Aviso enviado. Te contactaremos con la resolución.'],
    ['tab_reservas_cannot_host_pending', 'Imposibilidad de alojar en revisión por viajes4patas'],
    ['tab_reservas_cannot_host_reason_overbooking', 'Sobreventa / reserva duplicada'],
    ['tab_reservas_cannot_host_reason_damage_or_repairs', 'Daños u obras en el alojamiento'],
    ['tab_reservas_cannot_host_reason_supply_failure', 'Avería de suministros (agua, luz, calefacción…)'],
    ['tab_reservas_cannot_host_reason_force_majeure', 'Causa de fuerza mayor'],
    ['tab_reservas_cannot_host_reason_personal', 'Motivo personal'],
    ['tab_reservas_cannot_host_reason_other', 'Otro motivo'],
];

const TRAVELER_VARIABLES: readonly SeedVariable[] = [
    ['cv_inc_type_host_cannot_host', 'El alojamiento no puede atender la reserva'],
];

const PAGES: readonly SeedPage[] = [
    { page: 'cuenta', variables: HOST_VARIABLES },
    { page: 'cuenta_viajero', variables: TRAVELER_VARIABLES },
];

export class HostCannotHost1791500000014 implements MigrationInterface {
    name = 'HostCannotHost1791500000014'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE \`reservation_incidents\` MODIFY \`type\` enum(${ENUM_WITH}) NOT NULL`,
        );
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
        await queryRunner.query(
            `ALTER TABLE \`reservation_incidents\` MODIFY \`type\` enum(${ENUM_WITHOUT}) NOT NULL`,
        );
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
