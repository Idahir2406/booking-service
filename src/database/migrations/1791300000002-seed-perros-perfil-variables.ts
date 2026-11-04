import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Panel del viajero V1 (F-PV5): "Mis perros" + "Mi perfil" + cambio de
// contraseña seguro, texts in jvariables page 'cuenta_viajero' (same approach as
// SeedCancelacionViajeroVariables1791200000002: the page is created if missing, existing variables are
// skipped; down deletes only these keys). Only description_l1 exists in v4p_jvariables1; other languages
// come from jclientes_translations. Placeholders ({name}, {kg}) are replaced by js/traveler_*.js.
const CUSTOMER = 'v4p';

/** [variable, description_l1, link?] — link is stored as-is (PHP prefixes $hostId when relative). */
type SeedVariable = readonly [variable: string, text: string, link?: string];

interface SeedPage {
    page: string;
    variables: readonly SeedVariable[];
}

const PERROS_PERFIL_VARIABLES: readonly SeedVariable[] = [
    // Común
    ['cv_guardando', 'Guardando…'],
    // Mis perros
    ['cv_dogs_titulo', 'Mis perros'],
    ['cv_dogs_empty', 'Todavía no has guardado ningún perro. Añádelo para tener sus datos a mano.'],
    ['cv_dogs_add', 'Añadir perro'],
    ['cv_dogs_edit', 'Editar perro'],
    ['cv_dogs_delete', 'Eliminar'],
    ['cv_dogs_delete_confirm', '¿Seguro que quieres eliminar a {name} de tus perros?'],
    ['cv_dogs_deleted', 'Perro eliminado.'],
    ['cv_dogs_name', 'Nombre'],
    ['cv_dogs_weight', 'Peso (kg)'],
    ['cv_dogs_weight_help', 'Entre 0,5 y 120 kg. Con el peso calculamos su talla.'],
    ['cv_dogs_kg', '{kg} kg'],
    ['cv_dogs_size', 'Talla'],
    ['cv_dogs_ppp', 'Es un perro potencialmente peligroso (PPP)'],
    ['cv_dogs_ppp_help', 'Marca esta opción si tu perro está catalogado como PPP según la normativa. Algunos alojamientos no los admiten.'],
    ['cv_dogs_ppp_tag', 'PPP'],
    ['cv_dogs_photo', 'Foto'],
    ['cv_dogs_photo_change', 'Elegir foto'],
    ['cv_dogs_photo_remove', 'Quitar foto'],
    ['cv_dogs_max', 'Has llegado al máximo de perros guardados. Elimina alguno para añadir otro.'],
    ['cv_dogs_snapshot_aviso', 'Los cambios no afectan a reservas ya hechas: cada reserva conserva los datos del perro con los que se hizo.'],
    ['cv_dogs_saved', 'Perro guardado.'],
    ['cv_dogs_error', 'No se pudo guardar. Inténtalo de nuevo.'],
    ['cv_dogs_error_nombre', 'Escribe el nombre del perro (máximo 60 caracteres).'],
    ['cv_dogs_error_peso', 'Indica un peso entre 0,5 y 120 kg.'],
    ['cv_dogs_guardar', 'Guardar'],
    ['cv_dogs_cancelar', 'Cancelar'],
    // Imágenes (perros y avatar)
    ['cv_img_formatos', 'JPG, PNG o WebP. Máximo 5 MB.'],
    ['cv_img_error_tipo', 'Formato no admitido. Sube una imagen JPG, PNG o WebP.'],
    ['cv_img_error_size', 'La imagen es demasiado grande. El máximo son 5 MB.'],
    // Mi perfil
    ['cv_prof_titulo', 'Mi perfil'],
    ['cv_prof_avatar', 'Foto de perfil'],
    ['cv_prof_avatar_change', 'Cambiar foto'],
    ['cv_prof_avatar_remove', 'Quitar foto'],
    ['cv_prof_avatar_saved', 'Foto de perfil actualizada.'],
    ['cv_prof_datos', 'Datos personales'],
    ['cv_prof_name', 'Nombre'],
    ['cv_prof_surname', 'Apellidos'],
    ['cv_prof_email', 'Email'],
    ['cv_prof_email_ro', 'El email es tu usuario de acceso y no se puede cambiar desde aquí.'],
    ['cv_prof_phone', 'Teléfono'],
    ['cv_prof_phone_help', 'Opcional. Solo números y espacios, con prefijo + si quieres.'],
    ['cv_prof_guardar', 'Guardar cambios'],
    ['cv_prof_saved', 'Datos guardados.'],
    ['cv_prof_error', 'No se pudieron guardar los datos. Inténtalo de nuevo.'],
    ['cv_prof_error_nombre', 'Escribe tu nombre (máximo 80 caracteres).'],
    ['cv_prof_error_telefono', 'El teléfono no es válido.'],
    // Cambiar contraseña
    ['cv_pwd_titulo', 'Cambiar contraseña'],
    ['cv_pwd_desc', 'Por seguridad te pedimos tu contraseña actual.'],
    ['cv_pwd_actual', 'Contraseña actual'],
    ['cv_pwd_nueva', 'Nueva contraseña'],
    ['cv_pwd_repetir', 'Repite la nueva contraseña'],
    ['cv_pwd_requisitos', 'Mínimo 8 caracteres, con letras y números.'],
    ['cv_pwd_mostrar', 'Mostrar contraseñas'],
    ['cv_pwd_guardar', 'Cambiar contraseña'],
    ['cv_pwd_ok', 'Tu contraseña se ha cambiado.'],
    ['cv_pwd_error', 'No se pudo cambiar la contraseña. Inténtalo de nuevo.'],
    ['cv_pwd_error_actual', 'La contraseña actual no es correcta.'],
    ['cv_pwd_error_igual', 'La nueva contraseña debe ser distinta de la actual.'],
    ['cv_pwd_error_longitud', 'La nueva contraseña debe tener entre 8 y 72 caracteres.'],
    ['cv_pwd_error_debil', 'La nueva contraseña debe incluir letras y números.'],
    ['cv_pwd_error_distintas', 'Las contraseñas nuevas no coinciden.'],
    ['cv_pwd_error_intentos', 'Demasiados intentos fallidos. Espera unos minutos y vuelve a intentarlo.'],
    ['cv_pwd_fuerza_debil', 'Contraseña débil'],
    ['cv_pwd_fuerza_normal', 'Contraseña normal'],
    ['cv_pwd_fuerza_fuerte', 'Contraseña fuerte'],
    ['cv_pwd_fuerza_muy_fuerte', 'Contraseña muy fuerte'],
];

const PAGES: readonly SeedPage[] = [
    { page: 'cuenta_viajero', variables: PERROS_PERFIL_VARIABLES },
];

export class SeedPerrosPerfilVariables1791300000002 implements MigrationInterface {
    name = 'SeedPerrosPerfilVariables1791300000002'

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
