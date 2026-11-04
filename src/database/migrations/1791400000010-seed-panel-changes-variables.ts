import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Panel del viajero F-PV7b: "¿Necesitas cambiar tu reserva?" (solicitud de cambio),
// propuestas de cambio de V4P (antes/después, nuevo precio, diferencia, «Aceptar cambio» / «Mantener mi reserva
// actual») y alternativas de alojamiento (PDF §10, «Aceptar alternativa» / «No aceptar»). D8: un cambio con
// importe extra no se acepta en el panel ("V4P te contactará para completar el pago").
// Texts in jvariables page 'cuenta_viajero' (page created if missing, existing variables skipped; same approach as
// SeedPanelPayPendingVariables1791400000009). Only description_l1 exists in v4p_jvariables1 (utf8 3-byte: no
// emojis); other languages come from jclientes_translations. {fecha} / {importe} are replaced by JS, which also
// carries Spanish fallbacks while this seed is pending. down deletes only these keys.
// The plan proposed 1791400000003-seed-cambios-variables; that timestamp is taken, so it ships as ...010.
const CUSTOMER = "v4p";
const PAGE = "cuenta_viajero";

/** [variable, description_l1] */
type SeedVariable = readonly [variable: string, text: string];

const VARIABLES: readonly SeedVariable[] = [
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
];

export class SeedPanelChangesVariables1791400000010 implements MigrationInterface {
  name = "SeedPanelChangesVariables1791400000010";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const pageId = await this.ensurePage(queryRunner);
    await this.insertMissing(queryRunner, pageId);
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

  private async ensurePage(queryRunner: QueryRunner): Promise<number> {
    let pageId = await this.findPageId(queryRunner);
    if (pageId === undefined) {
      const [{ next_sequence }] = (await queryRunner.query(
        `SELECT COALESCE(MAX(\`sequence\`), 0) + 10 AS next_sequence FROM \`v4p_jvariables0\` WHERE \`customer\` = ?`,
        [CUSTOMER],
      )) as { next_sequence: number | string }[];
      await queryRunner.query(
        `INSERT INTO \`v4p_jvariables0\` (\`customer\`, \`sequence\`, \`pagina\`, \`seocaption_l1\`, \`seodescription_l1\`) VALUES (?, ?, ?, '-', '-')`,
        [CUSTOMER, Number(next_sequence), PAGE],
      );
      pageId = await this.findPageId(queryRunner);
    }
    if (pageId === undefined) {
      throw new Error(
        `could not create v4p_jvariables0 row for pagina=${PAGE}`,
      );
    }
    return pageId;
  }

  private async insertMissing(
    queryRunner: QueryRunner,
    pageId: number,
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

    for (const [variable, text] of VARIABLES) {
      if (existingKeys.has(variable)) {
        continue;
      }
      sequence += 10;
      await queryRunner.query(
        `INSERT INTO \`v4p_jvariables1\` (\`customer\`, \`idback\`, \`sequence\`, \`variable\`, \`description_l1\`, \`link\`) VALUES (?, ?, ?, ?, ?, '')`,
        [CUSTOMER, String(pageId), sequence, variable, text],
      );
    }
  }

  private async findPageId(
    queryRunner: QueryRunner,
  ): Promise<number | undefined> {
    const rows = (await queryRunner.query(
      `SELECT \`id\` FROM \`v4p_jvariables0\` WHERE \`customer\` = ? AND \`pagina\` = ? ORDER BY \`id\` LIMIT 1`,
      [CUSTOMER, PAGE],
    )) as { id: number }[];
    const [first] = rows as ({ id: number } | undefined)[];
    return first === undefined ? undefined : Number(first.id);
  }
}
