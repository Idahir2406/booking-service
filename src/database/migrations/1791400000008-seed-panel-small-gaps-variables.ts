import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Panel del viajero V1, "huecos pequeños" (2026-10-23):
//   §5.1 dirección del alojamiento en el detalle, §5.2 mensaje de compatibilidad de perros (snapshot),
//   §13 valoración enviada / ver mi valoración, §12 preferencias de comunicaciones (Mi perfil),
//   §14 confirmación de reserva imprimible (web/xx/reservation-confirmation.php).
// Texts in jvariables page 'cuenta_viajero' (page created if missing, existing variables skipped; same approach as
// SeedReservaDogsVariables1791400000003). Only description_l1 exists in v4p_jvariables1 (utf8 3-byte: no emojis);
// other languages come from jclientes_translations. Placeholders ({date}, {n}) are replaced by PHP/JS, which also
// carry Spanish fallbacks while this seed is pending. down deletes only these keys.
const CUSTOMER = "v4p";
const PAGE = "cuenta_viajero";

/** [variable, description_l1] */
type SeedVariable = readonly [variable: string, text: string];

const VARIABLES: readonly SeedVariable[] = [
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
  // §12 comunicaciones (Mi perfil)
  ["cv_comms_titulo", "Comunicaciones"],
  [
    "cv_comms_marketing",
    "Quiero recibir novedades, ofertas y la newsletter de Viajes 4Patas",
  ],
  [
    "cv_comms_help",
    "Los emails sobre tus reservas (confirmación, cambios, cancelaciones, pagos y reembolsos) se envían siempre: son necesarios para gestionar tus reservas y no se pueden desactivar. Puedes retirar este consentimiento cuando quieras.",
  ],
  ["cv_comms_guardar", "Guardar preferencias"],
  ["cv_comms_saved", "Preferencias guardadas."],
  [
    "cv_comms_error",
    "No se pudieron guardar tus preferencias. Inténtalo de nuevo.",
  ],
  [
    "cv_comms_no_disponible",
    "Las preferencias de comunicaciones no están disponibles en este momento.",
  ],
  ["cv_comms_actualizado", "Último cambio: {date}"],
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

export class SeedPanelSmallGapsVariables1791400000008 implements MigrationInterface {
  name = "SeedPanelSmallGapsVariables1791400000008";

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
