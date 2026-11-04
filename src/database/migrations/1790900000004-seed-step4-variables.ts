import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Wizard step 4 "Servicios" UI texts into the existing
// jvariables page 'registraralojamiento' (same approach as
// SeedSiteUnitsAndStep2Variables1790800000001: existing variables are skipped;
// down deletes only these keys, never the page).
const CUSTOMER = 'v4p';
const PAGE = 'registraralojamiento';

const VARIABLES: readonly (readonly [string, string])[] = [
    ['fsc_s4_title', 'Servicios'],
    ['fsc_s4_desc', 'Lo que ofreces a huéspedes y perros, y qué hay alrededor.'],
    ['fsc_s4_optional', 'Este paso es opcional, pero mejora tu Dog Friendly Score.'],
    ['fsc_s4_sec_dog', 'Para tu perro'],
    ['fsc_s4_amenities', 'Amenities'],
    ['fsc_s4_facilities', 'Instalaciones'],
    ['fsc_s4_services', 'Servicios adicionales'],
    ['fsc_s4_paid_warning', 'Los servicios de pago se añadirán al total de la reserva.'],
    ['fsc_s4_free', 'Gratis'],
    ['fsc_s4_paid', 'De pago'],
    ['fsc_s4_price', 'Precio'],
    ['fsc_s4_pricing_mode', 'Cómo se cobra'],
    ['fsc_s4_mode_per_stay', 'Por estancia'],
    ['fsc_s4_mode_per_night', 'Por noche'],
    ['fsc_s4_mode_per_pet_night', 'Por perro y noche'],
    ['fsc_s4_mode_per_pet_stay', 'Por perro y estancia'],
    ['fsc_s4_reviewed', 'Ya revisé esta sección'],
    ['fsc_s4_reviewed_help', 'Lo no marcado se guardará como "No".'],
    ['fsc_s4_reviewed_done', 'Sección revisada'],
    ['fsc_s4_extra_specs', 'Más sobre tu alojamiento'],
    ['fsc_s4_sec_site', 'Del alojamiento'],
    ['fsc_s4_sec_env', 'Entorno y experiencias'],
    ['fsc_s4_nearby', 'Servicios cercanos'],
    ['fsc_s4_selected', 'seleccionados'],
    ['fsc_s4_pending', 'Pendiente'],
    ['fsc_s4_saved', 'Servicios guardados'],
    ['fsc_s4_mode_ph', 'Elige una opción'],
    ['fsc_s4_price_required', 'Indica el precio.'],
    ['fsc_s4_price_range', 'Debe estar entre 0,01 y 10.000 €.'],
    ['fsc_s4_mode_required', 'Elige cómo se cobra.'],
];

export class SeedStep4Variables1790900000004 implements MigrationInterface {
    name = 'SeedStep4Variables1790900000004'

    public async up(queryRunner: QueryRunner): Promise<void> {
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

        const existing = await queryRunner.query(
            `SELECT \`variable\`, \`sequence\` FROM \`v4p_jvariables1\` WHERE \`customer\` = ? AND \`idback\` = ?`,
            [CUSTOMER, String(pageId)],
        ) as { variable: string; sequence: number | null }[];
        const existingKeys = new Set(existing.map(row => row.variable));
        let sequence = Math.max(0, ...existing.map(row => Number(row.sequence ?? 0)));

        for (const [variable, text] of VARIABLES) {
            if (existingKeys.has(variable)) {
                continue;
            }
            sequence += 10;
            await queryRunner.query(
                `INSERT INTO \`v4p_jvariables1\` (\`customer\`, \`idback\`, \`sequence\`, \`variable\`, \`description_l1\`) VALUES (?, ?, ?, ?, ?)`,
                [CUSTOMER, String(pageId), sequence, variable, text],
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
            [CUSTOMER, String(pageId), VARIABLES.map(([variable]) => variable)],
        );
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
