import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Wizard steps 5-7 UI texts (plus step 4 prefill hint) into the existing
// jvariables page 'registraralojamiento' (same approach as
// SeedSiteUnitsAndStep2Variables1790800000001: existing variables are skipped;
// down deletes only these keys, never the page).
const CUSTOMER = 'v4p';
const PAGE = 'registraralojamiento';

const VARIABLES: readonly (readonly [string, string])[] = [
    ['fsc_s4_prefilled', 'Precargado'],
    ['fsc_s4_prefilled_help', 'Marcado a partir de los datos actuales de tu alojamiento. Revísalo.'],
    ['fsc_s5_title', 'Fotos y descripción'],
    ['fsc_s5_desc', 'Lo primero que verán los viajeros: enseña tu alojamiento y cuéntales por qué es ideal para ir con perro.'],
    ['fsc_s5_photos_title', 'Fotos'],
    ['fsc_s5_photos_help', 'La primera foto será la portada. Arrastra las fotos o usa las flechas para cambiar el orden.'],
    ['fsc_s5_pick', 'Elegir fotos'],
    ['fsc_s5_drop', 'o arrástralas aquí'],
    ['fsc_s5_formats', 'JPG, PNG o WebP · máximo 5 MB por foto'],
    ['fsc_s5_full', 'Has alcanzado el máximo de fotos de tu plan.'],
    ['fsc_s5_empty', 'Todavía no has subido fotos. Sube al menos una para continuar.'],
    ['fsc_s5_quota', 'Te quedan {n} fotos en tu plan'],
    ['fsc_s5_quota_one', 'Te queda 1 foto en tu plan'],
    ['fsc_s5_quota_none', 'Has usado las {max} fotos de tu plan'],
    ['fsc_s5_cover', 'Portada'],
    ['fsc_s5_photo_alt', 'Foto {n}'],
    ['fsc_s5_move_prev', 'Mover antes'],
    ['fsc_s5_move_next', 'Mover después'],
    ['fsc_s5_delete', 'Eliminar foto'],
    ['fsc_s5_delete_confirm', '¿Eliminar esta foto?'],
    ['fsc_s5_delete_yes', 'Eliminar'],
    ['fsc_s5_moved', 'Foto movida a la posición {n}'],
    ['fsc_s5_deleted', 'Foto eliminada'],
    ['fsc_s5_optimizing', 'Optimizando…'],
    ['fsc_s5_uploading', 'Subiendo…'],
    ['fsc_s5_uploaded', 'Subida'],
    ['fsc_s5_dismiss', 'Quitar de la lista'],
    ['fsc_s5_err_type', 'Formato no admitido. Usa JPG, PNG o WebP.'],
    ['fsc_s5_err_size', 'La foto supera los 5 MB.'],
    ['fsc_s5_err_max', 'Has alcanzado el máximo de fotos de tu plan.'],
    ['fsc_s5_err_upload', 'No se pudo subir la foto. Inténtalo de nuevo.'],
    ['fsc_s5_err_order', 'No se pudo guardar el orden de las fotos.'],
    ['fsc_s5_err_delete', 'No se pudo eliminar la foto.'],
    ['fsc_s5_wait_uploads', 'Espera a que terminen de subirse las fotos.'],
    ['fsc_s5_need_photo', 'Sube al menos una foto.'],
    ['fsc_s5_texts_title', 'Descripción'],
    ['fsc_s5_short', 'Descripción corta'],
    ['fsc_s5_short_help', 'Un resumen de 2 o 3 frases. Aparece en los listados y en la cabecera de tu ficha.'],
    ['fsc_s5_long', 'Descripción completa'],
    ['fsc_s5_long_help', 'Opcional, pero recomendable: espacios, entorno, qué pueden hacer los perros y las normas de la casa.'],
    ['fsc_s5_need_short', 'Escribe la descripción corta.'],
    ['fsc_s5_saved', 'Descripción guardada'],
    ['fsc_s5_ideas_title', 'Ideas para escribir'],
    ['fsc_s5_idea_name', 'Empieza por lo que hace especial a {name} para viajar con perro.'],
    ['fsc_s5_idea_name_generic', 'Empieza por lo que hace especial a tu alojamiento para viajar con perro.'],
    ['fsc_s5_idea_town', 'Describe los alrededores de {town}: paseos, rutas, playas o parques donde ir con perro.'],
    ['fsc_s5_idea_env', 'Destaca el entorno: {list}.'],
    ['fsc_s5_idea_dog', 'Menciona lo que ofreces a los perros: {list}.'],
    ['fsc_s5_idea_features', 'Habla de tus instalaciones: {list}.'],
    ['fsc_s5_idea_zones', 'Explica a qué zonas comunes pueden acceder los perros y dónde pueden comer con sus dueños.'],
    ['fsc_s5_idea_rules', 'Aclara las normas de la casa para perros: sofás y camas, si pueden quedarse solos, zonas de paseo.'],
    ['fsc_s5_idea_contact', 'No incluyas teléfonos, emails ni webs: los viajeros reservan y contactan a través de Viajes 4Patas.'],
    ['fsc_s6_title', 'Reservas y cobros'],
    ['fsc_s6_desc', 'Cuándo se puede reservar y cómo recibirás los pagos.'],
    ['fsc_s6_avail_title', 'Disponibilidad'],
    ['fsc_s6_mode', '¿Cuándo está abierto tu alojamiento?'],
    ['fsc_s6_mode_all_year', 'Abierto todo el año'],
    ['fsc_s6_mode_seasons', 'Por temporadas'],
    ['fsc_s6_soon', 'Próximamente'],
    ['fsc_s6_mode_help', 'Más adelante podrás cerrar fechas concretas desde tu calendario.'],
    ['fsc_s6_need_mode', 'Elige cuándo está abierto tu alojamiento.'],
    ['fsc_s6_min_nights', 'Estancia mínima (noches)'],
    ['fsc_s6_min_help', 'Entre 1 y 30 noches.'],
    ['fsc_s6_max_nights', 'Estancia máxima (noches)'],
    ['fsc_s6_max_help', 'Igual o mayor que la mínima, hasta 365 noches.'],
    ['fsc_s6_err_min', 'La estancia mínima debe estar entre 1 y 30 noches.'],
    ['fsc_s6_err_max', 'La estancia máxima debe ser igual o mayor que la mínima y no superar 365 noches.'],
    ['fsc_s6_rooms', 'Se aplica a tus {n} unidades.'],
    ['fsc_s6_rooms_one', 'Se aplica a tu unidad.'],
    ['fsc_s6_saved', 'Disponibilidad guardada'],
    ['fsc_s6_stripe_title', 'Cobros con Stripe'],
    ['fsc_s6_stripe_intro', 'Para cobrar las reservas online conecta una cuenta Stripe Express. Puedes hacerlo ahora o más adelante desde tu perfil (pestaña Reservas).'],
    ['fsc_s6_stripe_loading', 'Comprobando el estado de tu cuenta Stripe…'],
    ['fsc_s6_stripe_pending', 'Aún no has conectado ninguna cuenta de cobros.'],
    ['fsc_s6_stripe_connect', 'Conectar cuenta'],
    ['fsc_s6_stripe_incomplete', 'Tu cuenta Stripe está creada pero aún no puede cobrar. Termina la configuración en Stripe.'],
    ['fsc_s6_stripe_resume', 'Continuar en Stripe'],
    ['fsc_s6_stripe_synced', 'Cuenta conectada'],
    ['fsc_s6_stripe_synced_help', 'Tu cuenta Stripe está lista para recibir los pagos de las reservas.'],
    ['fsc_s6_stripe_update', 'Actualizar datos en Stripe'],
    ['fsc_s6_stripe_error', 'No se pudo comprobar el estado de Stripe. Inténtalo de nuevo.'],
    ['fsc_s6_stripe_later', 'Lo haré más tarde'],
    ['fsc_s6_stripe_later_note', 'De acuerdo. Podrás conectar tu cuenta desde tu perfil, en la pestaña Reservas. Sin ella no podrás recibir reservas con pago online.'],
    ['fsc_s6_stripe_connect_now', 'Conectar ahora'],
    ['fsc_s7_title', 'Revisión y publicación'],
    ['fsc_s7_desc', 'Comprueba que todo está listo y envía tu alojamiento a revisión.'],
    ['fsc_s7_completed', 'Completado'],
    ['fsc_s7_pct_ok', 'Todo lo obligatorio está completo.'],
    ['fsc_s7_pct_missing', 'Faltan {n} elementos obligatorios.'],
    ['fsc_s7_pct_missing_one', 'Falta 1 elemento obligatorio.'],
    ['fsc_s7_score', 'Dog Friendly Score'],
    ['fsc_s7_paws', '{n} de 5 huellas'],
    ['fsc_s7_no_reviews', 'Sin valoraciones verificadas'],
    ['fsc_s7_reviews', '{avg} de media · {n} valoraciones verificadas'],
    ['fsc_s7_reviews_one', '{avg} · 1 valoración verificada'],
    ['fsc_s7_blocks_title', 'Cómo se calcula tu puntuación'],
    ['fsc_s7_blocks_help', 'Completa la política de perros y los servicios para mejorar tu puntuación. Las valoraciones verificadas de viajeros la irán ajustando.'],
    ['fsc_s7_block_policy', 'Política de perros'],
    ['fsc_s7_block_services', 'Servicios'],
    ['fsc_s7_block_integration', 'Integración y reservas'],
    ['fsc_s7_points', '{points} de {max} puntos'],
    ['fsc_s7_check_title', 'Lista de comprobación'],
    ['fsc_s7_step_label', 'Paso {n} · {name}'],
    ['fsc_s7_item_done', 'Completado'],
    ['fsc_s7_item_missing', 'Pendiente'],
    ['fsc_s7_complete', 'Completar'],
    ['fsc_s7_can_publish', 'Todo listo. Revisa las condiciones y envía tu alojamiento a revisión.'],
    ['fsc_s7_cannot_publish', 'Completa los elementos obligatorios pendientes para poder publicar.'],
    ['fsc_s7_publish', 'Publicar alojamiento'],
    ['fsc_s7_publish_error', 'No se pudo enviar a revisión. Revisa los elementos pendientes.'],
    ['fsc_s7_terms_title', 'Condiciones de publicación'],
    ['fsc_s7_terms_intro', 'Antes de enviar tu alojamiento a revisión, lee y acepta estas condiciones.'],
    ['fsc_s7_terms_version_label', 'Versión'],
    ['fsc_s7_terms_html', '<p>Estas condiciones regulan la publicación de alojamientos en Viajes 4Patas. Al enviar tu alojamiento a revisión declaras que las has leído y que las aceptas.</p><h4>1. Información veraz y actualizada</h4><p>Declaras que toda la información que facilitas (datos del alojamiento, unidades, precios, servicios, ubicación y contacto) es verdadera, corresponde a un alojamiento real que gestionas o que estás autorizado a comercializar, y te comprometes a mantenerla actualizada.</p><h4>2. Fotografías</h4><p>Las fotografías son tuyas o dispones de licencia o autorización suficiente para publicarlas, y autorizas a Viajes 4Patas a mostrarlas en la plataforma y en su promoción. Deben mostrar el alojamiento real y su estado actual. No se admiten retoques que induzcan a error (eliminar elementos, alterar espacios, vistas o estado de conservación) ni imágenes que no correspondan a tu alojamiento.</p><h4>3. Contenido no permitido</h4><p>En fotos y textos no puede haber contenido:</p><ul><li>obsceno o de carácter sexual;</li><li>violento, que incite al odio o discriminatorio por cualquier motivo;</li><li>ofensivo, difamatorio o contrario a la ley;</li><li>con datos personales de terceros o imágenes de personas reconocibles sin su consentimiento;</li><li>con teléfonos, emails, webs, redes sociales u otros datos de contacto destinados a eludir la reserva a través de la plataforma.</li></ul><h4>4. Política de perros</h4><p>La política de perros que configuras (tamaño máximo, número de perros, admisión de perros PPP, suplementos y fianza) debe ser exacta. Las reservas se validan y, en su caso, se bloquean con esa política, y te comprometes a respetarla con los viajeros que reserven cumpliéndola, sin aplicar cargos ni condiciones adicionales que no estén publicados.</p><h4>5. Cumplimiento normativo</h4><p>Eres responsable de cumplir la normativa aplicable a tu actividad: licencias y número de registro turístico cuando sean obligatorios, obligaciones fiscales y de registro de viajeros, y la legislación sobre perros de asistencia, cuyo acceso no puede impedirse ni condicionarse al pago de suplementos.</p><h4>6. Precios y disponibilidad</h4><p>Mantendrás actualizados los precios, suplementos y la disponibilidad. Las reservas confirmadas de acuerdo con la información publicada deberán respetarse.</p><h4>7. Revisión y moderación</h4><p>Tu alojamiento pasará una revisión antes de aparecer publicado. Viajes 4Patas podrá revisar y editar el anuncio (por ejemplo, para corregir errores o retirar datos de contacto), así como rechazarlo, suspenderlo o retirarlo si incumple estas condiciones o puede perjudicar a los viajeros, informándote del motivo.</p><h4>8. Protección de datos</h4><p>Tratamos tus datos y los de tu alojamiento conforme a nuestra <a href="privacity" target="_blank" rel="noopener">política de privacidad</a>.</p>'],
    ['fsc_s7_accept_terms', 'He leído y acepto las condiciones de publicación'],
    ['fsc_s7_accept_truth', 'Declaro que la información y las fotos son reales y veraces'],
    ['fsc_s7_accept_required', 'Marca las dos casillas para continuar.'],
    ['fsc_s7_submit', 'Aceptar y enviar a revisión'],
    ['fsc_s7_done_title', 'Tu alojamiento se ha enviado a revisión'],
    ['fsc_s7_done_text', 'Gracias. Nuestro equipo revisará la información y las fotos antes de publicarlo.'],
    ['fsc_s7_submitted_on', 'Enviado el {date}'],
    ['fsc_s7_next_title', 'Próximos pasos'],
    ['fsc_s7_next_1', 'Revisaremos tu alojamiento, normalmente en 2 o 3 días laborables.'],
    ['fsc_s7_next_2', 'Te avisaremos por email cuando esté publicado o si necesitamos que cambies algo.'],
    ['fsc_s7_next_3', 'Mientras tanto, puedes completar tu perfil, tu calendario y la conexión con Stripe.'],
    ['fsc_s7_go_profile', 'Ir a mi perfil'],
    ['fsc_s7_view_summary', 'Ver resumen'],
];

export class SeedSteps5To7Variables1790900000007 implements MigrationInterface {
    name = 'SeedSteps5To7Variables1790900000007'

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
