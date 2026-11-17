import { MigrationInterface, QueryRunner } from 'typeorm';

// Hand-written, idempotent. "Finalizar estancia" (pestaña Reservas del anfitrión, components/usprofile_reservations_tab.php
// + js/booking_reservations_list.js): desde 2026-11-15 se activa el día de check-out (hora local del alojamiento), no
// en el check-in, y el sistema la finaliza solo a las 48 h si el anfitrión no lo hace. Textos de la página jvariables
// 'cuenta'. Igual que SeedCheckoutAuthVariables1791500000011: crea la página si falta y no pisa variables existentes,
// salvo los textos antiguos exactos listados en OUTDATED (que describían la regla anterior).
const CUSTOMER = 'v4p';

/** [variable, description_l1, link?] */
type SeedVariable = readonly [variable: string, text: string, link?: string];

interface SeedPage {
    page: string;
    variables: readonly SeedVariable[];
}

const FINALIZE_VARIABLES: readonly SeedVariable[] = [
    ['tab_reservas_btn_finalize', 'Finalizar estancia'],
    ['tab_reservas_modal_finalize_title', 'Finalizar estancia'],
    ['tab_reservas_modal_finalize_desc', 'Confirma que el huésped ya ha dejado el alojamiento. No es una cancelación: la reserva se da por completada, el huésped recibirá un enlace para valorar la estancia y después se liberará tu pago.'],
    ['tab_reservas_policy_finalize_unavailable', 'Podrás finalizar la estancia a partir del día de salida ({date}).'],
    ['tab_reservas_policy_finalize_auto', 'Si no la finalizas, se finalizará automáticamente 48 h después de la salida.'],
];

/** Old texts replaced on up (only when the stored value is exactly this one). */
const OUTDATED: Readonly<Partial<Record<string, string>>> = {
    tab_reservas_policy_finalize_unavailable: 'Podrás finalizar la estancia cuando comience el check-in.',
    tab_reservas_modal_finalize_desc: 'Se enviará al huésped un enlace para valorar la estancia.',
};

const PAGES: readonly SeedPage[] = [
    { page: 'cuenta', variables: FINALIZE_VARIABLES },
];

export class SeedFinalizeStayVariables1791500000013 implements MigrationInterface {
    name = 'SeedFinalizeStayVariables1791500000013'

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const { page, variables } of PAGES) {
            const pageId = await this.ensurePage(queryRunner, page);
            await this.insertMissing(queryRunner, pageId, variables);
            for (const [variable, text] of variables) {
                const old = OUTDATED[variable];
                if (old === undefined) {
                    continue;
                }
                await queryRunner.query(
                    `UPDATE \`v4p_jvariables1\` SET \`description_l1\` = ? WHERE \`customer\` = ? AND \`idback\` = ? AND \`variable\` = ? AND \`description_l1\` = ?`,
                    [text, CUSTOMER, String(pageId), variable, old],
                );
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const { page } of PAGES) {
            const pageId = await this.findPageId(queryRunner, page);
            if (pageId === undefined) {
                continue;
            }
            // Only the key that did not exist before this migration.
            await queryRunner.query(
                `DELETE FROM \`v4p_jvariables1\` WHERE \`customer\` = ? AND \`idback\` = ? AND \`variable\` IN (?)`,
                [CUSTOMER, String(pageId), ['tab_reservas_policy_finalize_auto']],
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
