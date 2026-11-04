import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Panel del viajero V1 (F-PV6): "Inicio" (saludo, próximo viaje, perros, alertas),
// texts in jvariables page 'cuenta_viajero' (same approach as SeedPerrosPerfilVariables1791300000002: the page is
// created if missing, existing variables are skipped; down deletes only these keys). Only description_l1 exists in
// v4p_jvariables1; other languages come from jclientes_translations. Placeholders ({name}, {fecha}, {n}) are
// replaced by components/traveler_home_tab.php / js/traveler_home.js.
// No debt / "update payment method" texts: out of scope in V1 (plan §6).
const CUSTOMER = 'v4p';

/** [variable, description_l1, link?] — link is stored as-is (PHP prefixes $hostId when relative). */
type SeedVariable = readonly [variable: string, text: string, link?: string];

interface SeedPage {
    page: string;
    variables: readonly SeedVariable[];
}

const INICIO_VARIABLES: readonly SeedVariable[] = [
    // Saludo
    ['cv_home_saludo', 'Hola, {name}'],
    ['cv_home_intro', 'Aquí tienes lo más importante de tus viajes con tu perro.'],
    // Próximo viaje
    ['cv_home_proximo', 'Tu próximo viaje'],
    ['cv_home_proximas_total', 'Tienes {n} viajes próximos'],
    ['cv_home_ver_reservas', 'Ver todas mis reservas'],
    ['cv_home_sin_viajes', 'No tienes ningún viaje próximo. ¿Buscamos tu próxima escapada con tu perro?'],
    ['cv_home_buscar', 'Buscar alojamientos', 'alojamientos-admiten-perros-destino/todos-los-destinos'],
    // Perros
    ['cv_home_perros', 'Tus perros'],
    ['cv_home_sin_perros', 'Aún no has guardado a tu perro. Guárdalo para tener sus datos a mano.'],
    ['cv_home_add_perro', 'Añadir perro'],
    ['cv_home_ver_perros', 'Gestionar mis perros'],
    // Alertas
    ['cv_home_avisos', 'Avisos'],
    ['cv_alert_free_cancel', 'Puedes cancelar gratis hasta el {fecha}.'],
    ['cv_alert_incident', 'Tienes una incidencia en revisión. V4P te informará de la resolución.'],
    ['cv_alert_proposal', 'Tienes una propuesta de cambio pendiente de respuesta.'],
    ['cv_alert_alternative', 'Tienes una alternativa de alojamiento pendiente de respuesta.'],
    ['cv_alert_ver', 'Ver reserva'],
    // Errores
    ['cv_home_error', 'No hemos podido cargar tu resumen. Recarga la página para intentarlo de nuevo.'],
];

const PAGES: readonly SeedPage[] = [
    { page: 'cuenta_viajero', variables: INICIO_VARIABLES },
];

export class SeedInicioVariables1791300000003 implements MigrationInterface {
    name = 'SeedInicioVariables1791300000003'

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
