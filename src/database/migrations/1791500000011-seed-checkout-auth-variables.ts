import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Diálogo "Inicia sesión o crea tu cuenta" del checkout del wizard de reserva PHP
// (components/reservation_book_wizard.php + js/reservation_book.js + php/reservation_auth_api.php): el checkout
// exige sesión y sin ella "Pagar" abre este diálogo. Textos nrf_auth_* de la página jvariables 'reserva_checkout';
// la fuente de verdad del mapa es reservation_book_auth_text_map() en web/inc/reservation_book_texts.php (las
// etiquetas de campos se reutilizan de la página 'clublogin' y no se siembran aquí).
// Same approach as SeedReservaCheckoutVariables1791400000002: the page is created if missing, existing variables
// are skipped; down deletes only these keys. Only description_l1 exists in v4p_jvariables1; other languages come
// from jclientes_translations.
const CUSTOMER = 'v4p';

/** [variable, description_l1, link?] — link is stored as-is (PHP prefixes $hostId when relative). */
type SeedVariable = readonly [variable: string, text: string, link?: string];

interface SeedPage {
    page: string;
    variables: readonly SeedVariable[];
}

const CHECKOUT_AUTH_VARIABLES: readonly SeedVariable[] = [
    ['nrf_auth_title', 'Inicia sesión para pagar'],
    ['nrf_auth_intro', 'Inicia sesión o crea tu cuenta para completar el pago. Así podrás gestionar tu reserva desde tu panel.'],
    ['nrf_auth_register_title', 'Crear cuenta'],
    ['nrf_auth_login_btn', 'Iniciar sesión y pagar'],
    ['nrf_auth_register_btn', 'Crear cuenta y pagar'],
    ['nrf_auth_to_register', '¿No tienes cuenta? Regístrate'],
    ['nrf_auth_to_login', '¿Ya tienes cuenta? Inicia sesión'],
    ['nrf_auth_close', 'Cerrar'],
    ['nrf_auth_captcha', 'Código de la imagen'],
    ['nrf_auth_captcha_reload', 'Cambiar el código de la imagen'],
    ['nrf_auth_busy', 'Un momento…'],
    ['nrf_auth_host_account', 'Esta cuenta es de anfitrión. Para reservar, inicia sesión o regístrate con una cuenta de viajero.'],
    ['nrf_auth_too_many', 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.'],
    ['nrf_auth_err_required', 'Completa todos los campos.'],
    ['nrf_auth_err_email', 'Escribe un email válido.'],
    ['nrf_auth_err_credentials', 'El email o la contraseña no son correctos.'],
    ['nrf_auth_err_mismatch', 'Las contraseñas no coinciden.'],
    ['nrf_auth_err_short', 'La contraseña debe tener al menos 8 caracteres.'],
    ['nrf_auth_err_terms', 'Debes aceptar los términos y condiciones.'],
    ['nrf_auth_err_captcha', 'El código de la imagen no es correcto. Escribe el nuevo código.'],
    ['nrf_auth_err_registered', 'Ya existe una cuenta con este email. Inicia sesión.'],
    ['nrf_auth_err_generic', 'No se pudo completar. Inténtalo de nuevo.'],
];

const PAGES: readonly SeedPage[] = [
    { page: 'reserva_checkout', variables: CHECKOUT_AUTH_VARIABLES },
];

export class SeedCheckoutAuthVariables1791500000011 implements MigrationInterface {
    name = 'SeedCheckoutAuthVariables1791500000011'

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
