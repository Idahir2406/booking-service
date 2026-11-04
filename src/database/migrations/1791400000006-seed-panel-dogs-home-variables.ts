import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Panel del viajero, spec 2.2 (tarjeta de "Mis perros": "Teo · 12 kg · No PPP" + invitación
// a añadir foto) y 2.3 (Inicio: "Hola, {name} 👋 / ¿Preparados para vuestra próxima escapada?").
// Texts in jvariables page 'cuenta_viajero' (same approach as SeedInicioVariables1791300000003: page created if missing,
// existing variables are skipped). Only description_l1 exists in v4p_jvariables1; other languages come from
// jclientes_translations.
//
// Copy updates of EXISTING keys only touch rows that still hold the old seeded default, so admin edits are kept.
// cv_home_saludo is NOT changed: v4p_jvariables1 is utf8 (3-byte) and the 👋 emoji is 4-byte, so it cannot be stored;
// components/traveler_home_tab.php renders it as a decorative HTML entity after the greeting instead.
// down: deletes only the new keys and restores cv_home_intro only if it still holds the new default.
const CUSTOMER = 'v4p';
const PAGE = 'cuenta_viajero';

/** [variable, description_l1] */
type SeedVariable = readonly [variable: string, text: string];

/** [variable, oldDefault, newDefault] */
type CopyUpdate = readonly [variable: string, oldText: string, newText: string];

const NEW_VARIABLES: readonly SeedVariable[] = [
    // Mis perros (tarjeta): estado PPP explícito + invitación a añadir foto ({name} = nombre del perro)
    ['cv_dogs_no_ppp', 'No PPP'],
    ['cv_dogs_add_photo', 'Añadir foto de {name}'],
];

const COPY_UPDATES: readonly CopyUpdate[] = [
    ['cv_home_intro', 'Aquí tienes lo más importante de tus viajes con tu perro.', '¿Preparados para vuestra próxima escapada?'],
];

export class SeedPanelDogsHomeVariables1791400000006 implements MigrationInterface {
    name = 'SeedPanelDogsHomeVariables1791400000006'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const pageId = await this.ensurePage(queryRunner);
        await this.insertMissing(queryRunner, pageId, [
            ...NEW_VARIABLES,
            // If an updated key is missing altogether (seed 1791300000003 never ran), insert it with the new copy.
            ...COPY_UPDATES.map(([variable, , newText]) => [variable, newText] as const),
        ]);
        for (const [variable, oldText, newText] of COPY_UPDATES) {
            await queryRunner.query(
                `UPDATE \`v4p_jvariables1\` SET \`description_l1\` = ? WHERE \`customer\` = ? AND \`idback\` = ? AND \`variable\` = ? AND \`description_l1\` = ?`,
                [newText, CUSTOMER, String(pageId), variable, oldText],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const pageId = await this.findPageId(queryRunner);
        if (pageId === undefined) {
            return;
        }
        await queryRunner.query(
            `DELETE FROM \`v4p_jvariables1\` WHERE \`customer\` = ? AND \`idback\` = ? AND \`variable\` IN (?)`,
            [CUSTOMER, String(pageId), NEW_VARIABLES.map(([variable]) => variable)],
        );
        for (const [variable, oldText, newText] of COPY_UPDATES) {
            await queryRunner.query(
                `UPDATE \`v4p_jvariables1\` SET \`description_l1\` = ? WHERE \`customer\` = ? AND \`idback\` = ? AND \`variable\` = ? AND \`description_l1\` = ?`,
                [oldText, CUSTOMER, String(pageId), variable, newText],
            );
        }
    }

    private async ensurePage(queryRunner: QueryRunner): Promise<number> {
        let pageId = await this.findPageId(queryRunner);
        if (pageId === undefined) {
            const [{ next_sequence }] = await queryRunner.query(
                `SELECT COALESCE(MAX(\`sequence\`), 0) + 10 AS next_sequence FROM \`v4p_jvariables0\` WHERE \`customer\` = ?`,
                [CUSTOMER],
            ) as { next_sequence: number | string }[];
            await queryRunner.query(
                `INSERT INTO \`v4p_jvariables0\` (\`customer\`, \`sequence\`, \`pagina\`, \`seocaption_l1\`, \`seodescription_l1\`) VALUES (?, ?, ?, '-', '-')`,
                [CUSTOMER, Number(next_sequence), PAGE],
            );
            pageId = await this.findPageId(queryRunner);
        }
        if (pageId === undefined) {
            throw new Error(`could not create v4p_jvariables0 row for pagina=${PAGE}`);
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
            existingKeys.add(variable);
            sequence += 10;
            await queryRunner.query(
                `INSERT INTO \`v4p_jvariables1\` (\`customer\`, \`idback\`, \`sequence\`, \`variable\`, \`description_l1\`, \`link\`) VALUES (?, ?, ?, ?, ?, '')`,
                [CUSTOMER, String(pageId), sequence, variable, text],
            );
        }
    }

    private async findPageId(queryRunner: QueryRunner): Promise<number | undefined> {
        const rows = await queryRunner.query(
            `SELECT \`id\` FROM \`v4p_jvariables0\` WHERE \`customer\` = ? AND \`pagina\` = ? ORDER BY \`id\` LIMIT 1`,
            [CUSTOMER, PAGE],
        ) as { id: number }[];
        const [first] = rows as ({ id: number } | undefined)[];
        return first === undefined ? undefined : Number(first.id);
    }
}
