import { MigrationInterface, QueryRunner } from "typeorm";

// Re-aplica idempotentemente textos de Mis reservas (listado, detalle, cancelación, pagos,
// cambios/alternativas, confirmación) e incidencias (desde el detalle de reserva) cuando las seeds
// originales ya están en migrations pero faltan filas en v4p_jvariables1.
const CUSTOMER = "v4p";
const PAGE = "cuenta_viajero";

type SeedVariable = readonly [variable: string, text: string, link?: string];

const VARIABLES: readonly SeedVariable[] = [
  // Cancelación (1791200000002)
  // Botón + modal
    ['cv_cancel_btn', 'Cancelar reserva'],
    ['cv_cancel_titulo', 'Cancelar reserva'],
    ['cv_cancel_motivo', 'Motivo de la cancelación'],
    ['cv_cancel_motivo_placeholder', 'Elige un motivo'],
    // Motivos (PDF): la clave termina en el código que valida la API
    ['cv_cancel_reason_change_of_plans', 'Cambio de planes'],
    ['cv_cancel_reason_illness_person', 'Enfermedad de una persona del viaje'],
    ['cv_cancel_reason_illness_pet', 'Enfermedad del perro'],
    ['cv_cancel_reason_death_person', 'Fallecimiento de un familiar'],
    ['cv_cancel_reason_death_pet', 'Fallecimiento del perro'],
    ['cv_cancel_reason_transport', 'Problemas de transporte'],
    ['cv_cancel_reason_financial', 'Motivos económicos'],
    ['cv_cancel_reason_other_accommodation', 'He encontrado otro alojamiento'],
    ['cv_cancel_reason_booking_error', 'Me equivoqué al reservar'],
    ['cv_cancel_reason_accommodation_conditions', 'Las condiciones del alojamiento no son las esperadas'],
    ['cv_cancel_reason_dog_conditions', 'Las condiciones para perros no son las esperadas'],
    ['cv_cancel_reason_force_majeure', 'Circunstancia excepcional o fuerza mayor'],
    ['cv_cancel_reason_other', 'Otro motivo'],
    // Notas
    ['cv_cancel_notas', 'Cuéntanos qué ha pasado'],
    ['cv_cancel_notas_obligatorias', 'Para este motivo es obligatorio explicar lo ocurrido (mínimo 10 caracteres).'],
    ['cv_cancel_motivo_no_cambia', 'El motivo no cambia el importe del reembolso, salvo en circunstancias excepcionales que revisa Viajes 4Patas.'],
    ['cv_cancel_ver_importes', 'Ver importes'],
    // Preview
    ['cv_cancel_preview_pagado', 'Importe pagado'],
    ['cv_cancel_preview_penalizacion', 'Penalización'],
    ['cv_cancel_preview_reembolso', 'Importe a reembolsar'],
    ['cv_cancel_preview_reembolso_solicitable', 'Reembolso solicitable tras revisión'],
    ['cv_cancel_preview_deadline', 'Cancelación gratuita hasta'],
    ['cv_cancel_preview_gratis', 'Estás dentro del plazo de cancelación gratuita.'],
    ['cv_cancel_preview_fuera_plazo', 'El plazo de cancelación gratuita ha terminado: se aplica la penalización indicada.'],
    ['cv_cancel_preview_sin_pago', 'Esta reserva todavía no se ha pagado: se cancelará sin ningún cargo.'],
    ['cv_cancel_legacy_text', 'Puedes cancelar con reembolso del importe pagado hasta la fecha límite indicada. Después de esa fecha la cancelación no tiene reembolso.'],
    ['cv_cancel_revision_v4p', 'Viajes 4Patas revisará tu caso. Te contactaremos y, si procede, recibirás el reembolso indicado. Ten a mano la documentación que lo justifique.'],
    // Confirmación y resultado
    ['cv_cancel_confirmar', 'Confirmar cancelación'],
    ['cv_cancel_volver', 'Volver'],
    ['cv_cancel_cerrar', 'Cerrar'],
    ['cv_cancel_ok', 'Tu reserva se ha cancelado.'],
    ['cv_cancel_error', 'No se pudo cancelar la reserva. Inténtalo de nuevo.'],
    ['cv_cancel_no_disponible', 'Esta reserva ya no se puede cancelar desde tu cuenta. Si necesitas ayuda, contacta con nosotros.'],
    ['cv_cancel_bloqueada_incidencia', 'Hay una incidencia en revisión en esta reserva. Mientras se resuelve no puedes cancelarla desde tu cuenta.'],
  // Incidencias detalle + hilo (1791400000001)
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
  ['cv_inc_type_no_show', 'No presentación indicada por el alojamiento'],
  // Pagar reserva (1791400000009)
  ["cv_pagar_btn", "Pagar reserva"],
  ["cv_pagar_disponible_hasta", "Disponible hasta {fecha}"],
  [
    "cv_pagar_aviso",
    "Tu reserva está pendiente de pago. Complétalo para confirmarla.",
  ],
  ["cv_pagar_redirigiendo", "Te llevamos al pago seguro..."],
  ["cv_pagar_err_caducada", "Esta reserva ha caducado"],
  ["cv_pagar_err_no_disponible", "Las fechas ya no están disponibles"],
  [
    "cv_pagar_err_procesando",
    "El pago de esta reserva se está procesando. Revisa su estado en unos minutos.",
  ],
  ["cv_pagar_err_pagada", "Esta reserva ya está pagada."],
  ["cv_pagar_err", "No se pudo iniciar el pago. Inténtalo de nuevo."],
  // Cambios / propuestas / alternativas (1791400000010)
  ["cv_chg_lista_titulo", "Cambios en tu reserva"],
  ["cv_chg_pregunta", "¿Necesitas cambiar tu reserva?"],
  ["cv_chg_btn", "Solicitar ayuda"],
  ["cv_chg_titulo", "Solicitar un cambio en tu reserva"],
  ["cv_chg_intro", "Cuéntanos qué necesitas. V4P y el alojamiento revisarán disponibilidad, capacidad, precio y compatibilidad con tus perros."],
  ["cv_chg_tipo", "¿Qué quieres cambiar?"],
  ["cv_chg_tipo_placeholder", "Elige una opción"],
  ["cv_chg_type_add_nights", "Añadir noches"],
  ["cv_chg_type_change_dates", "Cambiar fechas"],
  ["cv_chg_type_travelers", "Cambiar número de viajeros"],
  ["cv_chg_type_dogs", "Cambiar perros"],
  ["cv_chg_type_extras", "Añadir o modificar un servicio o extra"],
  ["cv_chg_type_other", "Otro"],
  ["cv_chg_mensaje", "Explícanos el cambio (opcional)"],
  ["cv_chg_mensaje_placeholder", "Por ejemplo: nos gustaría llegar un día más tarde."],
  ["cv_chg_aviso_original", "Tu reserva actual sigue vigente. Esta solicitud no modifica ni cancela tu reserva: seguirá confirmada hasta que aceptes una propuesta de cambio y esta se complete."],
  ["cv_chg_enviar", "Enviar solicitud"],
  ["cv_chg_volver", "Volver"],
  ["cv_chg_cerrar", "Cerrar"],
  ["cv_chg_ok", "Hemos recibido tu solicitud. Tu reserva sigue confirmada sin cambios mientras la revisamos."],
  ["cv_chg_error", "No se pudo enviar la solicitud. Inténtalo de nuevo."],
  ["cv_chg_ya_abierta", "Ya tienes una solicitud de cambio abierta para esta reserva."],
  ["cv_chg_limite", "Has alcanzado el máximo de solicitudes para esta reserva."],
  ["cv_chg_no_disponible", "Esta reserva ya no admite solicitudes de cambio."],
  ["cv_chg_status_received", "Recibida"],
  ["cv_chg_status_in_review", "En revisión"],
  ["cv_chg_status_proposal_sent", "Propuesta enviada"],
  ["cv_chg_status_accepted", "Aceptada"],
  ["cv_chg_status_rejected", "Rechazada"],
  ["cv_chg_status_cancelled", "Cancelada"],
  ["cv_chg_enviada_el", "Enviada el {fecha}"],
  ["cv_chg_respuesta", "Respuesta de V4P"],
  ["cv_chg_rechazada_info", "No ha sido posible hacer este cambio. Tu reserva se mantiene sin cambios."],
  ["cv_chg_cancelar_solicitud", "Retirar solicitud"],
  ["cv_chg_cancelar_confirm", "¿Retirar esta solicitud? Tu reserva no cambia."],
  ["cv_chg_cancelada_ok", "Solicitud retirada. Tu reserva no cambia."],
  ["cv_chg_prop_titulo", "Propuesta de cambio"],
  ["cv_chg_prop_campo", "Concepto"],
  ["cv_chg_prop_antes", "Antes"],
  ["cv_chg_prop_despues", "Después"],
  ["cv_chg_prop_fechas", "Fechas"],
  ["cv_chg_prop_noches", "Noches"],
  ["cv_chg_prop_viajeros", "Viajeros"],
  ["cv_chg_prop_perros", "Perros"],
  ["cv_chg_prop_unidad", "Alojamiento"],
  ["cv_chg_prop_regimen", "Régimen"],
  ["cv_chg_prop_servicios", "Servicios y extras"],
  ["cv_chg_prop_precio", "Precio total"],
  ["cv_chg_prop_nuevo_precio", "Nuevo precio"],
  ["cv_chg_prop_diferencia", "Diferencia"],
  ["cv_chg_prop_sin_diferencia", "Sin diferencia de precio"],
  ["cv_chg_prop_devolucion", "Al aceptar te devolveremos {importe} a tu método de pago."],
  ["cv_chg_prop_condiciones", "Condiciones aplicables"],
  ["cv_chg_prop_mensaje", "Mensaje de V4P"],
  ["cv_chg_prop_valida_hasta", "Puedes responder hasta {fecha}"],
  ["cv_chg_prop_aceptar", "Aceptar cambio"],
  ["cv_chg_prop_mantener", "Mantener mi reserva actual"],
  ["cv_chg_prop_pago_contacto", "Este cambio tiene un coste adicional. V4P te contactará para completar el pago; hasta entonces tu reserva actual sigue vigente."],
  ["cv_chg_prop_vencida", "Esta propuesta ha caducado. Tu reserva no ha cambiado."],
  ["cv_chg_prop_confirmar", "¿Confirmas el cambio? Tu reserva se actualizará con los datos de la propuesta."],
  ["cv_chg_prop_aceptada_ok", "Cambio aplicado. Tu reserva ya está actualizada."],
  ["cv_chg_prop_mantener_ok", "Perfecto, mantienes tu reserva actual sin cambios."],
  ["cv_chg_prop_no_disponible", "Este cambio ya no es posible (disponibilidad o condiciones). Tu reserva no ha cambiado y V4P lo revisará."],
  ["cv_chg_prop_error", "No se pudo completar la acción. Inténtalo de nuevo."],
  ["cv_chg_prop_status_accepted", "Cambio aplicado"],
  ["cv_chg_prop_status_rejected", "Mantuviste tu reserva actual"],
  ["cv_chg_prop_status_expired", "Propuesta caducada o ya no disponible"],
  ["cv_chg_sin_dato", "Sin cambios"],
  ["cv_alt_titulo", "Alternativa de alojamiento"],
  ["cv_alt_texto", "El alojamiento no puede ofrecer tu estancia tal como la reservaste. V4P te propone esta alternativa. Nada cambia si no la aceptas."],
  ["cv_alt_condiciones_perros", "Condiciones para perros"],
  ["cv_alt_compatible", "Compatible con los perros que declaraste"],
  ["cv_alt_incompatible", "Esta alternativa no es compatible con los perros que declaraste y no puede aceptarse."],
  ["cv_alt_max_perros", "Máximo de perros"],
  ["cv_alt_talla_max", "Talla máxima"],
  ["cv_alt_ppp", "PPP admitidos"],
  ["cv_alt_solos", "Pueden quedarse solos"],
  ["cv_alt_suplemento", "Suplemento por perros"],
  ["cv_alt_fianza", "Fianza"],
  ["cv_alt_aceptar", "Aceptar alternativa"],
  ["cv_alt_rechazar", "No aceptar"],
  ["cv_alt_confirmar", "¿Aceptas esta alternativa? Tu reserva se trasladará a este alojamiento."],
  ["cv_alt_aceptada_ok", "Alternativa aceptada. Tu reserva ya está actualizada."],
  ["cv_alt_rechazada_ok", "Has rechazado la alternativa. Tu reserva no cambia y V4P seguirá gestionando tu caso."],
  ["cv_alt_status_accepted", "Alternativa aceptada"],
  ["cv_alt_status_rejected", "Alternativa no aceptada"],
  ["cv_alt_status_expired", "Alternativa caducada o ya no disponible"],
  // Detalle reserva + confirmación imprimible (1791400000008, sin cv_comms_*)
  // §5.1 / §5.2 detalle
  ["cv_det_direccion", "Dirección"],
  [
    "cv_det_perros_compatibles",
    "Tus perros cumplen las condiciones de esta reserva",
  ],
  // §13 valoración
  ["cv_det_valoracion_enviada", "Valoración enviada"],
  ["cv_det_ver_valoracion", "Ver mi valoración"],
  ["cv_det_ocultar_valoracion", "Ocultar mi valoración"],
  ["cv_det_valoracion_puntuacion", "Puntuación"],
  ["cv_det_valoracion_estrellas", "{n} de 5"],
  ["cv_det_valoracion_comentario", "Comentario"],
  ["cv_det_valoracion_fecha", "Enviada el"],
  [
    "cv_det_valoracion_aviso",
    "Enviaste un aviso sobre esta estancia. Lo revisará el equipo de Viajes 4Patas.",
  ],
  // §14 acceso desde el detalle
  ["cv_det_confirmacion", "Confirmación de reserva"],
  // §14 página de confirmación
  ["cv_conf_titulo", "Confirmación de reserva"],
  ["cv_conf_referencia", "Referencia V4P"],
  ["cv_conf_estado", "Estado de la reserva"],
  ["cv_conf_alojamiento", "Alojamiento"],
  ["cv_conf_unidad", "Unidad"],
  ["cv_conf_direccion", "Dirección"],
  ["cv_conf_estancia", "Estancia"],
  ["cv_conf_viajeros", "Viajeros"],
  ["cv_conf_perros", "Perros"],
  ["cv_conf_perros_declarados", "Perros declarados"],
  ["cv_conf_precio", "Precio"],
  ["cv_conf_estado_pago", "Estado del pago"],
  ["cv_conf_sin_pago", "Sin pagos registrados"],
  ["cv_conf_politica", "Política de cancelación"],
  ["cv_conf_deadline", "Cancelación con reembolso hasta"],
  ["cv_conf_condiciones", "Condiciones Dog Friendly aceptadas"],
  ["cv_conf_imprimir", "Imprimir / Guardar PDF"],
  ["cv_conf_volver", "Volver a la reserva"],
  ["cv_conf_emitida", "Documento generado el {date}"],
  [
    "cv_conf_nota",
    "Este documento resume tu reserva con las condiciones que aceptaste al reservar. No es una factura.",
  ],
  ["cv_conf_no_encontrada", "No hemos encontrado esta reserva en tu cuenta."],
  [
    "cv_conf_error",
    "No se pudo cargar la confirmación. Inténtalo de nuevo más tarde.",
  ],
];

export class RepairReservasIncidenciasVariables1791500000004
  implements MigrationInterface
{
  name = "RepairReservasIncidenciasVariables1791500000004";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const pageId = await this.ensurePage(queryRunner, PAGE);
    await this.insertMissing(queryRunner, pageId, VARIABLES);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const pageId = await this.findPageId(queryRunner, PAGE);
    if (pageId === undefined) {
      return;
    }
    await queryRunner.query(
      `DELETE FROM \`v4p_jvariables1\` WHERE \`customer\` = ? AND \`idback\` = ? AND \`variable\` IN (?)`,
      [CUSTOMER, String(pageId), VARIABLES.map(([variable]) => variable)],
    );
  }

  private async ensurePage(
    queryRunner: QueryRunner,
    page: string,
  ): Promise<number> {
    let pageId = await this.findPageId(queryRunner, page);
    if (pageId === undefined) {
      const [{ next_sequence }] = (await queryRunner.query(
        `SELECT COALESCE(MAX(\`sequence\`), 0) + 10 AS next_sequence FROM \`v4p_jvariables0\` WHERE \`customer\` = ?`,
        [CUSTOMER],
      )) as { next_sequence: number | string }[];
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

  private async insertMissing(
    queryRunner: QueryRunner,
    pageId: number,
    variables: readonly SeedVariable[],
  ): Promise<void> {
    const existing = (await queryRunner.query(
      `SELECT \`variable\`, \`sequence\` FROM \`v4p_jvariables1\` WHERE \`customer\` = ? AND \`idback\` = ?`,
      [CUSTOMER, String(pageId)],
    )) as { variable: string; sequence: number | null }[];
    const existingKeys = new Set(existing.map(row => row.variable));
    let sequence = Math.max(
      0,
      ...existing.map(row => Number(row.sequence ?? 0)),
    );

    for (const [variable, text, link] of variables) {
      if (existingKeys.has(variable)) {
        continue;
      }
      sequence += 10;
      await queryRunner.query(
        `INSERT INTO \`v4p_jvariables1\` (\`customer\`, \`idback\`, \`sequence\`, \`variable\`, \`description_l1\`, \`link\`) VALUES (?, ?, ?, ?, ?, ?)`,
        [CUSTOMER, String(pageId), sequence, variable, text, link ?? ""],
      );
    }
  }

  private async findPageId(
    queryRunner: QueryRunner,
    page: string,
  ): Promise<number | undefined> {
    const rows = (await queryRunner.query(
      `SELECT \`id\` FROM \`v4p_jvariables0\` WHERE \`customer\` = ? AND \`pagina\` = ? ORDER BY \`id\` LIMIT 1`,
      [CUSTOMER, page],
    )) as { id: number }[];
    const [first] = rows as ({ id: number } | undefined)[];
    return first === undefined ? undefined : Number(first.id);
  }
}
