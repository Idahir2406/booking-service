import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Panel del viajero V1 (F-PV7a): "Tengo un problema" (incidencias, adjuntos, hilo de
// mensajes, estados funcionales Recibida / En revisión / Necesitamos información / Resuelta) + "Pendiente de revisión
// V4P" de la cancelación por fuerza mayor. Texts in jvariables page 'cuenta_viajero' (same approach as
// SeedInicioVariables1791300000003: the page is created if missing, existing variables are skipped; down deletes
// only these keys). Only description_l1 exists in v4p_jvariables1; other languages come from jclientes_translations.
// Placeholders ({n}, {mb}, {fecha}) are replaced by js/traveler_incidents.js.
const CUSTOMER = 'v4p';

/** [variable, description_l1, link?] — link is stored as-is (PHP prefixes $hostId when relative). */
type SeedVariable = readonly [variable: string, text: string, link?: string];

interface SeedPage {
    page: string;
    variables: readonly SeedVariable[];
}

const INCIDENCIAS_VARIABLES: readonly SeedVariable[] = [
    // Bloque del detalle
    ['cv_inc_btn', 'Tengo un problema con mi reserva'],
    ['cv_inc_titulo', 'Cuéntanos qué ha pasado'],
    ['cv_inc_lista_titulo', 'Tus incidencias'],
    ['cv_inc_intro', 'Revisaremos tu caso y te responderemos aquí. Puedes adjuntar fotos o documentos.'],
    // Tipos
    ['cv_inc_tipo', 'Tipo de problema'],
    ['cv_inc_tipo_placeholder', 'Elige el tipo de problema'],
    ['cv_inc_type_before_arrival', 'Antes de llegar'],
    ['cv_inc_type_during_stay', 'Durante la estancia'],
    ['cv_inc_type_dog_issue', 'Problema con mi perro'],
    ['cv_inc_type_conditions_not_respected', 'No se han respetado las condiciones'],
    ['cv_inc_type_charge_issue', 'Problema con un cobro'],
    ['cv_inc_type_refund_issue', 'Problema con un reembolso'],
    ['cv_inc_type_force_majeure_cancellation', 'Cancelación por circunstancia excepcional'],
    ['cv_inc_type_other', 'Otro'],
    // Formulario
    ['cv_inc_desc', 'Describe el problema'],
    ['cv_inc_desc_help', 'Entre 20 y 2000 caracteres. Cuanto más detalle, antes podremos ayudarte.'],
    ['cv_inc_desc_error', 'La descripción debe tener entre 20 y 2000 caracteres.'],
    ['cv_inc_adjuntos', 'Adjuntos (opcional)'],
    ['cv_inc_adjuntos_help', 'Hasta {n} archivos PDF, JPG, PNG o WEBP de {mb} MB como máximo cada uno.'],
    ['cv_inc_enviar', 'Enviar incidencia'],
    ['cv_inc_volver', 'Volver'],
    ['cv_inc_cerrar', 'Cerrar'],
    ['cv_inc_ok', 'Hemos recibido tu incidencia. Te avisaremos cuando la revisemos.'],
    ['cv_inc_ok_adjuntos_error', 'Hemos recibido tu incidencia, pero algún adjunto no se ha podido subir. Puedes volver a intentarlo desde la incidencia.'],
    ['cv_inc_error', 'No hemos podido enviar tu incidencia. Inténtalo de nuevo.'],
    ['cv_inc_ya_abierta', 'Ya tienes una incidencia abierta de este tipo en esta reserva.'],
    ['cv_inc_limite', 'Has alcanzado el límite de incidencias o mensajes. Contacta con nosotros si necesitas ayuda.'],
    ['cv_inc_no_disponible', 'Ya no se puede abrir una incidencia en esta reserva.'],
    ['cv_inc_bloquea_cancelacion', 'Mientras revisamos esta incidencia la reserva no se puede cancelar desde el panel.'],
    // Estados (funcionales, nunca el enum)
    ['cv_inc_status_received', 'Recibida'],
    ['cv_inc_status_in_review', 'En revisión'],
    ['cv_inc_status_needs_info', 'Necesitamos información'],
    ['cv_inc_status_resolved', 'Resuelta'],
    ['cv_inc_abierta_el', 'Abierta el {fecha}'],
    ['cv_inc_needs_info_aviso', 'Necesitamos más información para continuar. Respóndenos abajo y, si hace falta, adjunta documentos.'],
    ['cv_inc_resolucion', 'Resolución'],
    // Hilo de mensajes
    ['cv_inc_mensajes', 'Mensajes'],
    ['cv_inc_autor_traveler', 'Tú'],
    ['cv_inc_autor_admin', 'Equipo viajes4patas'],
    ['cv_inc_responder', 'Responder'],
    ['cv_inc_responder_placeholder', 'Escribe tu respuesta'],
    ['cv_inc_respuesta_ok', 'Respuesta enviada. Seguimos revisando tu caso.'],
    ['cv_inc_respuesta_error', 'No hemos podido enviar tu respuesta. Inténtalo de nuevo.'],
    // Adjuntos
    ['cv_inc_adjuntar', 'Adjuntar archivo'],
    ['cv_inc_adjunto_ok', 'Archivo adjuntado.'],
    ['cv_inc_adjunto_max', 'Ya has adjuntado el máximo de archivos para esta incidencia.'],
    ['cv_inc_adjunto_error_tipo', 'Formato no admitido. Usa PDF, JPG, PNG o WEBP.'],
    ['cv_inc_adjunto_error_size', 'El archivo supera el tamaño máximo permitido.'],
    ['cv_inc_adjunto_error', 'No hemos podido subir el archivo. Inténtalo de nuevo.'],
    ['cv_inc_descargar', 'Descargar'],
    // Fuerza mayor (cancelación F-PV4 + incidencia enlazada)
    ['cv_fm_pendiente_v4p', 'Pendiente de revisión V4P: revisaremos la documentación y te informaremos del reembolso.'],
    ['cv_fm_adjuntar', 'Adjunta la documentación que justifica la circunstancia excepcional (por ejemplo, un certificado médico).'],
];

const PAGES: readonly SeedPage[] = [
    { page: 'cuenta_viajero', variables: INCIDENCIAS_VARIABLES },
];

export class SeedIncidenciasVariables1791400000001 implements MigrationInterface {
    name = 'SeedIncidenciasVariables1791400000001'

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
