import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Pestaña "Incidencias" del panel del viajero (chat por alojamiento, 2026-10-25):
// textos de la bandeja/conversación (página 'cuenta_viajero', cv_*) y del acceso en el menú de cuenta
// (página 'menu', acct_incidencias). Same approach as SeedMenuAccountHeaderVariables1791400000005: the page
// is created if missing, existing variables are skipped; down deletes only these keys, never the page.
// Only description_l1 exists in v4p_jvariables1; other languages come from jclientes_translations.
// PHP/JS keep Spanish fallbacks while this seed has not run.
const CUSTOMER = 'v4p';

/** [variable, description_l1, link?] — link is stored as-is (PHP prefixes $hostIdLang when relative). */
type SeedVariable = readonly [variable: string, text: string, link?: string];

interface SeedPage {
    page: string;
    variables: readonly SeedVariable[];
}

const CUENTA_VIAJERO_VARIABLES: readonly SeedVariable[] = [
    ['cv_nav_incidencias', 'Incidencias'],
    ['cv_inc_inbox_intro', 'Aquí tienes todas tus incidencias, agrupadas por alojamiento. Cada mensaje te llega también por email.'],
    ['cv_inc_inbox_vacio', 'Todavía no tienes incidencias.'],
    ['cv_inc_inbox_vacio_hint', 'Las incidencias se abren desde el detalle de cada reserva.'],
    ['cv_inc_inbox_ir_reservas', 'Ir a mis reservas'],
    ['cv_inc_inbox_error', 'No hemos podido cargar tus incidencias. Inténtalo de nuevo.'],
    ['cv_inc_alojamiento', 'Alojamiento'],
    ['cv_inc_ultima_actividad', 'Última actividad: {fecha}'],
    ['cv_inc_contador', '{mensajes} mensajes · {adjuntos} adjuntos'],
    ['cv_inc_estancia', 'Estancia: {fechas}'],
    ['cv_inc_volver_bandeja', 'Volver a incidencias'],
    ['cv_inc_ver_conversacion', 'Ver conversación'],
    ['cv_inc_conversacion', 'Conversación'],
    ['cv_inc_descripcion_inicial', 'Incidencia abierta'],
    ['cv_inc_adjuntos_titulo', 'Adjuntos'],
    ['cv_inc_chat_label', 'Tu mensaje'],
    ['cv_inc_chat_placeholder', 'Escribe tu mensaje'],
    ['cv_inc_chat_enviar', 'Enviar mensaje'],
    ['cv_inc_chat_enviado', 'Mensaje enviado. Te enviaremos una copia por email.'],
    ['cv_inc_chat_email_hint', 'Te enviaremos una copia de cada mensaje por email.'],
    ['cv_inc_chat_vacio_error', 'Escribe un mensaje o adjunta un archivo.'],
    ['cv_inc_chat_closed_error', 'La incidencia se ha cerrado y ya no admite mensajes.'],
    ['cv_inc_chat_cerrada', 'Esta incidencia está resuelta y ya no admite mensajes. Si necesitas algo más, abre una nueva desde el detalle de la reserva.'],
    ['cv_inc_detalle_error', 'No hemos podido cargar la conversación.'],
];

const MENU_VARIABLES: readonly SeedVariable[] = [
    ['acct_incidencias', 'Incidencias'],
];

const PAGES: readonly SeedPage[] = [
    { page: 'cuenta_viajero', variables: CUENTA_VIAJERO_VARIABLES },
    { page: 'menu', variables: MENU_VARIABLES },
];

export class SeedIncidentsTabVariables1791400000012 implements MigrationInterface {
    name = 'SeedIncidentsTabVariables1791400000012'

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
