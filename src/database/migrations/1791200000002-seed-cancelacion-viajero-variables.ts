import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Panel del viajero V1 (F-PV4): cancellation preview + 13 PDF reasons
// texts in jvariables page 'cuenta_viajero' (same approach as SeedCuentaViajeroVariables1791200000001:
// the page is created if missing, existing variables are skipped; down deletes only these keys).
// Only description_l1 exists in v4p_jvariables1; other languages come from jclientes_translations.
const CUSTOMER = 'v4p';

/** [variable, description_l1, link?] — link is stored as-is (PHP prefixes $hostId when relative). */
type SeedVariable = readonly [variable: string, text: string, link?: string];

interface SeedPage {
    page: string;
    variables: readonly SeedVariable[];
}

const CANCELACION_VARIABLES: readonly SeedVariable[] = [
    // Botón + modal
    ['cv_cancel_btn', 'Cancelar reserva'],
    ['cv_cancel_titulo', 'Cancelar reserva'],
    ['cv_cancel_motivo', 'Motivo de la cancelación'],
    ['cv_cancel_motivo_placeholder', 'Elige un motivo'],
    // Motivos (PDF): la clave termina en el código que valida la API
    ['cv_cancel_reason_change_of_plans', 'Cambio de planes'],
    ['cv_cancel_reason_illness_person', 'Enfermedad de una persona del viaje'],
    ['cv_cancel_reason_illness_pet', 'Enfermedad del perro'],
    ['cv_cancel_reason_death_person', 'Fallecimiento de un familiar'],
    ['cv_cancel_reason_death_pet', 'Fallecimiento del perro'],
    ['cv_cancel_reason_transport', 'Problemas de transporte'],
    ['cv_cancel_reason_financial', 'Motivos económicos'],
    ['cv_cancel_reason_other_accommodation', 'He encontrado otro alojamiento'],
    ['cv_cancel_reason_booking_error', 'Me equivoqué al reservar'],
    ['cv_cancel_reason_accommodation_conditions', 'Las condiciones del alojamiento no son las esperadas'],
    ['cv_cancel_reason_dog_conditions', 'Las condiciones para perros no son las esperadas'],
    ['cv_cancel_reason_force_majeure', 'Circunstancia excepcional o fuerza mayor'],
    ['cv_cancel_reason_other', 'Otro motivo'],
    // Notas
    ['cv_cancel_notas', 'Cuéntanos qué ha pasado'],
    ['cv_cancel_notas_obligatorias', 'Para este motivo es obligatorio explicar lo ocurrido (mínimo 10 caracteres).'],
    ['cv_cancel_motivo_no_cambia', 'El motivo no cambia el importe del reembolso, salvo en circunstancias excepcionales que revisa Viajes 4Patas.'],
    ['cv_cancel_ver_importes', 'Ver importes'],
    // Preview
    ['cv_cancel_preview_pagado', 'Importe pagado'],
    ['cv_cancel_preview_penalizacion', 'Penalización'],
    ['cv_cancel_preview_reembolso', 'Importe a reembolsar'],
    ['cv_cancel_preview_reembolso_solicitable', 'Reembolso solicitable tras revisión'],
    ['cv_cancel_preview_deadline', 'Cancelación gratuita hasta'],
    ['cv_cancel_preview_gratis', 'Estás dentro del plazo de cancelación gratuita.'],
    ['cv_cancel_preview_fuera_plazo', 'El plazo de cancelación gratuita ha terminado: se aplica la penalización indicada.'],
    ['cv_cancel_preview_sin_pago', 'Esta reserva todavía no se ha pagado: se cancelará sin ningún cargo.'],
    ['cv_cancel_legacy_text', 'Puedes cancelar con reembolso del importe pagado hasta la fecha límite indicada. Después de esa fecha la cancelación no tiene reembolso.'],
    ['cv_cancel_revision_v4p', 'Viajes 4Patas revisará tu caso. Te contactaremos y, si procede, recibirás el reembolso indicado. Ten a mano la documentación que lo justifique.'],
    // Confirmación y resultado
    ['cv_cancel_confirmar', 'Confirmar cancelación'],
    ['cv_cancel_volver', 'Volver'],
    ['cv_cancel_cerrar', 'Cerrar'],
    ['cv_cancel_ok', 'Tu reserva se ha cancelado.'],
    ['cv_cancel_error', 'No se pudo cancelar la reserva. Inténtalo de nuevo.'],
    ['cv_cancel_no_disponible', 'Esta reserva ya no se puede cancelar desde tu cuenta. Si necesitas ayuda, contacta con nosotros.'],
    ['cv_cancel_bloqueada_incidencia', 'Hay una incidencia en revisión en esta reserva. Mientras se resuelve no puedes cancelarla desde tu cuenta.'],
];

const PAGES: readonly SeedPage[] = [
    { page: 'cuenta_viajero', variables: CANCELACION_VARIABLES },
];

export class SeedCancelacionViajeroVariables1791200000002 implements MigrationInterface {
    name = 'SeedCancelacionViajeroVariables1791200000002'

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
