import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written. UI texts of the accommodation onboarding wizard, stored the legacy PHP way:
// one v4p_jvariables0 page row (pagina) + v4p_jvariables1 rows (idback = page id as string).
// Both ids are AUTO_INCREMENT. Idempotent: reuses the page row and skips existing variables.
// Translations (ca/en/fr/pt) go to v4p_jclientes_translations via the existing PHP tooling.
const PAGE = 'registraralojamiento';
const CUSTOMER = 'v4p';

const VARIABLES: readonly (readonly [string, string])[] = [
    ['fsc_page_title', 'Registra tu alojamiento'],
    ['fsc_page_subtitle', 'Completa los pasos para publicar tu alojamiento en Viajes 4Patas.'],
    ['fsc_step1', 'Alojamiento'],
    ['fsc_step2', 'Unidades'],
    ['fsc_step3', 'Perros'],
    ['fsc_step4', 'Servicios'],
    ['fsc_step5', 'Fotos'],
    ['fsc_step6', 'Reservas'],
    ['fsc_step7', 'Publicar'],
    ['fsc_btn_back', 'Atrás'],
    ['fsc_btn_next', 'Continuar'],
    ['fsc_btn_save_exit', 'Guardar y salir'],
    ['fsc_saving', 'Guardando…'],
    ['fsc_saved', 'Borrador guardado'],
    ['fsc_error_generic', 'No se pudo guardar. Revisa los campos marcados.'],
    ['fsc_required', 'Obligatorio'],
    ['fsc_optional', 'Opcional'],
    ['fsc_step_soon', 'Este paso estará disponible próximamente.'],
    ['fsc_s1_title', 'Tu alojamiento'],
    ['fsc_s1_desc', 'Qué es, cómo se llama y dónde está.'],
    ['fsc_s1_sec_type', 'Tipo'],
    ['fsc_s1_main_type', 'Tipo principal'],
    ['fsc_s1_main_type_help', 'Elige el que mejor describe tu alojamiento.'],
    ['fsc_s1_other_types', 'Otras categorías (opcional)'],
    ['fsc_s1_rent_type', 'Tipo de alquiler'],
    ['fsc_s1_sec_contact', 'Contacto'],
    ['fsc_s1_name', 'Nombre del alojamiento'],
    ['fsc_s1_name_help', 'Nombre comercial, tal como lo verán los viajeros.'],
    ['fsc_s1_email', 'Email de reservas'],
    ['fsc_s1_email_help', 'Email principal de contacto para tus clientes y reservas.'],
    ['fsc_s1_email2', 'Email comercial (opcional)'],
    ['fsc_s1_phone', 'Teléfono'],
    ['fsc_s1_whatsapp', 'WhatsApp (opcional)'],
    ['fsc_s1_whatsapp_help', 'Solo números, sin prefijo de país.'],
    ['fsc_s1_sec_location', 'Ubicación'],
    ['fsc_s1_province', 'Provincia'],
    ['fsc_s1_town', 'Población'],
    ['fsc_s1_town_help', 'Primero elige la provincia.'],
    ['fsc_s1_map_help', 'Arrastra el pin a la ubicación exacta de tu alojamiento.'],
    ['fsc_s1_interest', 'Lugar de interés cercano'],
    ['fsc_s1_interest_help', 'Ej: Costa Brava, Picos de Europa.'],
    ['fsc_s1_distance', 'Distancia al centro (opcional)'],
    ['fsc_s1_location_text', 'Ubicación en la localidad (opcional)'],
    ['fsc_s1_env', 'Tipo de entorno'],
    ['fsc_s1_dest', 'Tipo de destino'],
    ['fsc_s1_add_email2', '+ Añadir email comercial'],
    ['fsc_invalid_email', 'Introduce un email válido.'],
    ['fsc_invalid_phone', 'Introduce un teléfono válido.'],
    ['fsc_invalid_whatsapp', 'Introduce solo números (6 a 15 dígitos).'],
    ['fsc_no_results', 'Sin resultados'],
    ['fsc_loading', 'Cargando…'],
    ['fsc_load_error', 'No se pudieron cargar los datos. Recarga la página.'],
];

export class SeedRegistrarAlojamientoVariables1790400000001 implements MigrationInterface {
    name = 'SeedRegistrarAlojamientoVariables1790400000001'

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
            `SELECT \`variable\` FROM \`v4p_jvariables1\` WHERE \`customer\` = ? AND \`idback\` = ?`,
            [CUSTOMER, String(pageId)],
        ) as { variable: string }[];
        const existingKeys = new Set(existing.map(row => row.variable));

        for (const [index, [variable, text]] of VARIABLES.entries()) {
            if (existingKeys.has(variable)) {
                continue;
            }
            await queryRunner.query(
                `INSERT INTO \`v4p_jvariables1\` (\`customer\`, \`idback\`, \`sequence\`, \`variable\`, \`description_l1\`) VALUES (?, ?, ?, ?, ?)`,
                [CUSTOMER, String(pageId), (index + 1) * 10, variable, text],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const pageId = await this.findPageId(queryRunner);
        if (pageId === undefined) {
            return;
        }
        await queryRunner.query(
            `DELETE FROM \`v4p_jvariables1\` WHERE \`customer\` = ? AND \`idback\` = ?`,
            [CUSTOMER, String(pageId)],
        );
        await queryRunner.query(
            `DELETE FROM \`v4p_jvariables0\` WHERE \`customer\` = ? AND \`pagina\` = ?`,
            [CUSTOMER, PAGE],
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
