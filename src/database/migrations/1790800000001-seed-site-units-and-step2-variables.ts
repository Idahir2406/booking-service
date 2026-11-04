import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent.
// 1) site_units catalog per legacy tipsite (v4p_jtipsite ids). Key = (tipsite_id, slug)
//    (unique index uq_site_units_tipsite_slug); existing pairs are skipped.
// 2) Wizard step 2 UI texts into the existing jvariables page 'registraralojamiento'
//    (same approach as SeedRegistrarAlojamientoVariables1790400000001: existing
//    variables are skipped; down deletes only these keys, never the page).
const CUSTOMER = 'v4p';
const PAGE = 'registraralojamiento';

type UnitSeed = readonly [slug: string, name: string, isFullUse: boolean];

const HOTEL_UNITS: readonly UnitSeed[] = [
    ['habitacion-individual', 'Habitación individual', false],
    ['habitacion-doble', 'Habitación doble', false],
    ['habitacion-triple', 'Habitación triple', false],
    ['habitacion-familiar', 'Habitación familiar', false],
    ['suite', 'Suite', false],
];

// tipsite id -> units (sort_order = 10, 20, ... in this order)
const SITE_UNITS: readonly (readonly [number, readonly UnitSeed[]])[] = [
    [1, HOTEL_UNITS], // Hoteles
    [10, HOTEL_UNITS], // Hoteles Rurales
    [2, [ // Casas Rurales
        ['casa-completa', 'Casa completa', true],
        ['habitacion', 'Habitación', false],
        ['apartamento-rural', 'Apartamento rural', true],
    ]],
    [3, [ // Campings
        ['parcela', 'Parcela', true],
        ['bungalow', 'Bungalow', true],
        ['mobile-home', 'Mobile-home', true],
        ['tienda-equipada', 'Tienda equipada', true],
    ]],
    [5, [ // Apartamentos
        ['apartamento', 'Apartamento', true],
        ['estudio', 'Estudio', true],
        ['loft', 'Loft', true],
    ]],
    [6, [ // Complejo turístico
        ['apartamento', 'Apartamento', true],
        ['bungalow', 'Bungalow', true],
        ['villa', 'Villa', true],
        ['habitacion', 'Habitación', false],
    ]],
    [7, [ // Albergues y Hostales
        ['habitacion-privada', 'Habitación privada', false],
        ['cama-en-habitacion-compartida', 'Cama en habitación compartida', false],
    ]],
    [8, [ // Villas y Chalets
        ['villa-completa', 'Villa completa', true],
        ['chalet-completo', 'Chalet completo', true],
    ]],
    [9, [ // Cabañas
        ['cabana', 'Cabaña', true],
        ['casa-del-arbol', 'Casa del árbol', true],
    ]],
];

const VARIABLES: readonly (readonly [string, string])[] = [
    ['fsc_s2_title', 'Unidades'],
    ['fsc_s2_desc', 'Lo que se reserva: habitaciones, apartamentos, la casa completa, parcelas...'],
    ['fsc_s2_add', 'Añadir unidad'],
    ['fsc_s2_empty_title', 'Añade tu primera unidad'],
    ['fsc_s2_empty_desc', 'Cada unidad es algo que un viajero puede reservar.'],
    ['fsc_s2_tab_data', 'Datos'],
    ['fsc_s2_tab_board', 'Régimen'],
    ['fsc_s2_tab_extras', 'Extras'],
    ['fsc_s2_unit_type', 'Tipo de unidad'],
    ['fsc_s2_unit_type_help', 'Según el tipo de alojamiento elegido en el paso 1.'],
    ['fsc_s2_full_use', 'Uso completo'],
    ['fsc_s2_unit_name', 'Nombre'],
    ['fsc_s2_unit_name_ph', 'Ej: Habitación doble con terraza'],
    ['fsc_s2_unit_desc', 'Descripción (opcional)'],
    ['fsc_s2_guests', 'Huéspedes máximos'],
    ['fsc_s2_bathrooms', 'Baños'],
    ['fsc_s2_price', 'Precio por noche'],
    ['fsc_s2_copies', '¿Cuántas iguales tienes?'],
    ['fsc_s2_copies_help', 'Crearemos una unidad por cada una, con el mismo precio y régimen.'],
    ['fsc_s2_board_help', 'Marca los regímenes que ofreces y cuál es el de por defecto.'],
    ['fsc_s2_board_included', 'Incluido en el precio'],
    ['fsc_s2_board_default', 'Por defecto'],
    // Board price = supplement per night per unit (not per guest), added to price_per_night
    ['fsc_s2_board_price', 'Suplemento por noche'],
    ['fsc_s2_extras_help', 'Extras opcionales que el viajero puede añadir.'],
    ['fsc_s2_extra_add', 'Añadir extra'],
    ['fsc_s2_extra_name', 'Nombre del extra'],
    ['fsc_s2_extra_mode', 'Cómo se cobra'],
    ['fsc_s2_extra_price', 'Precio'],
    ['fsc_s2_save_unit', 'Guardar unidad'],
    ['fsc_s2_cancel', 'Cancelar'],
    ['fsc_s2_edit', 'Editar'],
    ['fsc_s2_delete', 'Eliminar'],
    ['fsc_s2_delete_confirm', '¿Eliminar esta unidad? Si tiene reservas futuras se desactivará.'],
    ['fsc_s2_summary_units', 'unidades'],
    ['fsc_s2_summary_capacity', 'capacidad'],
    ['fsc_s2_summary_from', 'desde'],
    ['fsc_s2_need_one', 'Añade al menos una unidad para continuar.'],
    ['fsc_s2_need_step1', 'Completa primero el paso 1 (tipo principal).'],
    ['fsc_s2_unit_type_ph', 'Elige un tipo'],
    ['fsc_s2_board_offer', 'Ofrecer'],
    ['fsc_s2_board_need_one', 'Ofrece al menos un régimen.'],
    ['fsc_s2_board_need_default', 'Elige el régimen por defecto.'],
    ['fsc_s2_board_one_included', 'Solo un régimen puede estar incluido en el precio.'],
    ['fsc_s2_extras_empty', 'Todavía no has añadido extras.'],
    ['fsc_s2_extra_remove', 'Quitar extra'],
    ['fsc_s2_delete_yes', 'Sí, eliminar'],
    ['fsc_s2_new_unit', 'Nueva unidad'],
    ['fsc_s2_edit_unit', 'Editar unidad'],
    ['fsc_s2_inactive', 'Inactiva'],
    ['fsc_s2_guest_one', 'huésped'],
    ['fsc_s2_guest_many', 'huéspedes'],
    ['fsc_s2_bath_one', 'baño'],
    ['fsc_s2_bath_many', 'baños'],
    ['fsc_s2_per_night', '/noche'],
    ['fsc_s2_less', 'Menos'],
    ['fsc_s2_more', 'Más'],
    ['fsc_s2_retry', 'Reintentar'],
    ['fsc_s2_unit_saved', 'Unidad guardada'],
    ['fsc_s2_unit_deleted', 'Unidad eliminada'],
    ['fsc_s2_finish_editing', 'Guarda o cancela la unidad que estás editando.'],
    ['fsc_s2_invalid_number', 'Introduce un número válido.'],
    ['fsc_s2_range', 'Debe estar entre {min} y {max}.'],
    ['fsc_s2_go_step1', 'Ir al paso 1'],
    ['fsc_s2_summary_unit', 'unidad'],
];

export class SeedSiteUnitsAndStep2Variables1790800000001 implements MigrationInterface {
    name = 'SeedSiteUnitsAndStep2Variables1790800000001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.seedSiteUnits(queryRunner);
        await this.seedVariables(queryRunner);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // rooms.site_unit_id is ON DELETE SET NULL: rooms survive, unclassified
        for (const [tipsiteId, units] of SITE_UNITS) {
            await queryRunner.query(
                `DELETE FROM \`site_units\` WHERE \`tipsite_id\` = ? AND \`slug\` IN (?)`,
                [tipsiteId, units.map(([slug]) => slug)],
            );
        }

        const pageId = await this.findPageId(queryRunner);
        if (pageId !== undefined) {
            await queryRunner.query(
                `DELETE FROM \`v4p_jvariables1\` WHERE \`customer\` = ? AND \`idback\` = ? AND \`variable\` IN (?)`,
                [CUSTOMER, String(pageId), VARIABLES.map(([variable]) => variable)],
            );
        }
    }

    private async seedSiteUnits(queryRunner: QueryRunner): Promise<void> {
        for (const [tipsiteId, units] of SITE_UNITS) {
            for (const [index, [slug, name, isFullUse]] of units.entries()) {
                await queryRunner.query(
                    `INSERT INTO \`site_units\` (\`tipsite_id\`, \`slug\`, \`name\`, \`is_full_use\`, \`sort_order\`, \`is_active\`)
                     SELECT ?, ?, ?, ?, ?, 1 FROM DUAL
                     WHERE NOT EXISTS (SELECT 1 FROM \`site_units\` WHERE \`tipsite_id\` = ? AND \`slug\` = ?)`,
                    [tipsiteId, slug, name, isFullUse ? 1 : 0, (index + 1) * 10, tipsiteId, slug],
                );
            }
        }
    }

    private async seedVariables(queryRunner: QueryRunner): Promise<void> {
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
        let sequence = existing.reduce((max, row) => Math.max(max, Number(row.sequence ?? 0)), 0);

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

    private async findPageId(queryRunner: QueryRunner): Promise<number | undefined> {
        const rows = await queryRunner.query(
            `SELECT \`id\` FROM \`v4p_jvariables0\` WHERE \`customer\` = ? AND \`pagina\` = ? ORDER BY \`id\` LIMIT 1`,
            [CUSTOMER, PAGE],
        ) as { id: number }[];
        const [first] = rows as ({ id: number } | undefined)[];
        return first === undefined ? undefined : Number(first.id);
    }
}
