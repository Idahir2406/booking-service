import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Wizard de reserva PHP (/reservar/{id}-{alias}), paso 2 "Tus perros": cada perro
// guardado se añade una sola vez (chip alterna añadir/quitar), diálogo "Añadir nuevo perro" (el mismo de
// Mis perros, js/traveler_dog_dialog.js) y nombres de perro no repetidos. Nuevos textos nrf_* de la página
// jvariables 'reserva_checkout' (fuente del mapa: web/inc/reservation_book_texts.php). El diálogo reutiliza los
// cv_* de 'cuenta_viajero' (SeedPerrosPerfilVariables1791300000002). Same approach as
// SeedReservaCheckoutVariables1791400000002 (already run): page created if missing, existing variables skipped;
// down deletes only these keys. Placeholders ({n}, {name}) are replaced by js/reservation_book.js.
const CUSTOMER = 'v4p';

/** [variable, description_l1, link?] — link is stored as-is (PHP prefixes $hostId when relative). */
type SeedVariable = readonly [variable: string, text: string, link?: string];

interface SeedPage {
    page: string;
    variables: readonly SeedVariable[];
}

const RESERVA_DOGS_VARIABLES: readonly SeedVariable[] = [
    ['nrf_saved_dogs_empty', 'Aún no tienes perros guardados. Añade uno y quedará guardado en Mis perros.'],
    ['nrf_saved_dog_selected', 'Añadido a la reserva. Pulsa de nuevo para quitarlo.'],
    ['nrf_dog_create_new', 'Añadir nuevo perro'],
    ['nrf_dog_create_notice', 'Lo guardaremos en Mis perros y lo añadiremos a esta reserva.'],
    ['nrf_dog_created', '{name} se ha guardado en tus perros y se ha añadido a la reserva.'],
    ['nrf_dog_duplicate_name', 'Ya hay otro perro con este nombre en la reserva.'],
    ['nrf_dog_duplicate_saved', 'Ya tienes un perro guardado con este nombre: púlsalo para añadirlo a la reserva.'],
    ['nrf_dogs_limit_reached', 'Has llegado al máximo de perros que admite esta opción ({n}).'],
];

const PAGES: readonly SeedPage[] = [
    { page: 'reserva_checkout', variables: RESERVA_DOGS_VARIABLES },
];

export class SeedReservaDogsVariables1791400000003 implements MigrationInterface {
    name = 'SeedReservaDogsVariables1791400000003'

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
