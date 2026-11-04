import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Wizard step 3 "Perros" UI texts into the existing
// jvariables page 'registraralojamiento' (same approach as
// SeedSiteUnitsAndStep2Variables1790800000001: existing variables are skipped;
// down deletes only these keys, never the page).
const CUSTOMER = 'v4p';
const PAGE = 'registraralojamiento';

const VARIABLES: readonly (readonly [string, string])[] = [
    ['fsc_s3_title', 'Política de perros'],
    ['fsc_s3_desc', 'Qué perros aceptas. Tamaño, número de perros y PPP bloquean la reserva si no se cumplen.'],
    ['fsc_s3_max_title', 'Máximo de perros en el alojamiento'],
    ['fsc_s3_max_help', 'Aplica a todo el alojamiento, por reserva.'],
    ['fsc_s3_unlimited', 'Sin límite'],
    ['fsc_s3_units_title', 'Política por unidad'],
    ['fsc_s3_copy_from', 'Copiar de otra unidad'],
    ['fsc_s3_copy_confirm', 'Se sustituirá la política de esta unidad.'],
    ['fsc_s3_size', '¿Hasta qué tamaño admites?'],
    ['fsc_s3_size_help', 'Incluye automáticamente los tamaños menores.'],
    ['fsc_s3_ppp', '¿Admites perros PPP?'],
    ['fsc_s3_supplement', '¿Cobras suplemento por perro?'],
    ['fsc_s3_supplement_none', 'No, gratis'],
    ['fsc_s3_supplement_yes', 'Sí'],
    ['fsc_s3_supplement_amount', 'Importe'],
    ['fsc_s3_supplement_mode', 'Modalidad'],
    ['fsc_s3_mode_per_pet_night', 'Por perro y noche'],
    ['fsc_s3_mode_per_pet_stay', 'Por perro y estancia'],
    ['fsc_s3_mode_fixed_stay', 'Fijo por estancia'],
    ['fsc_s3_example', 'Ejemplo: 2 perros × 3 noches = {total}'],
    ['fsc_s3_left_alone', '¿Puede quedarse solo en la unidad?'],
    ['fsc_s3_left_yes', 'Sí'],
    ['fsc_s3_left_no', 'No'],
    ['fsc_s3_left_conditional', 'Con condiciones'],
    ['fsc_s3_left_conditions', 'Indica las condiciones'],
    ['fsc_s3_zones', '¿A qué zonas comunes puede acceder?'],
    ['fsc_s3_zones_none', 'Ninguna'],
    ['fsc_s3_zone_other_text', 'Indica cuál'],
    ['fsc_s3_dining', '¿Dónde puede comer el viajero con su perro?'],
    ['fsc_s3_dining_none', 'En ninguna'],
    ['fsc_s3_full_access', '¿Puede moverse libremente por toda la unidad?'],
    ['fsc_s3_deposit', '¿Pides fianza por daños?'],
    ['fsc_s3_deposit_amount', 'Importe de la fianza'],
    ['fsc_s3_deposit_return', 'Devolución'],
    ['fsc_s3_deposit_end', 'Al finalizar la estancia'],
    ['fsc_s3_deposit_days', 'En un máximo de N días tras la salida'],
    ['fsc_s3_deposit_days_label', 'Días'],
    ['fsc_s3_deposit_note', 'Viajes 4Patas no cobra la fianza: la gestiona el alojamiento.'],
    ['fsc_s3_notes', 'Observaciones (opcional)'],
    ['fsc_s3_notes_help', 'Solo informativo. No se usa para filtrar ni puntuar.'],
    ['fsc_s3_assistance', 'Los perros de asistencia se rigen por la normativa vigente y no se configuran aquí.'],
    ['fsc_s3_complete', 'Completa'],
    ['fsc_s3_incomplete', 'Faltan datos'],
    ['fsc_s3_need_units', 'Añade al menos una unidad en el paso 2.'],
    ['fsc_s3_block_warning', 'Si el perro del viajero no cumple el tamaño, el número o la condición PPP, la reserva se bloquea.'],
    ['fsc_s3_saved', 'Política guardada'],
    ['fsc_yes', 'Sí'],
    ['fsc_no', 'No'],
    ['fsc_s3_go_step2', 'Ir al paso 2'],
    ['fsc_s3_copy_yes', 'Sí, copiar'],
    ['fsc_s3_size_upto', 'Hasta {kg} kg'],
    ['fsc_s3_size_last', '{name} (más de {kg} kg, sin límite)'],
];

export class SeedStep3Variables1790900000001 implements MigrationInterface {
    name = 'SeedStep3Variables1790900000001'

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
