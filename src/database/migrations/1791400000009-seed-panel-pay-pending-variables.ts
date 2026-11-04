import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Panel del viajero, "Pagar reserva" (pay-pending, 2026-10-23): botón para retomar el pago
// de una reserva inconclusa (pending + pago pendiente, aún no caducada) en la pestaña tv_reservas (listado, detalle)
// y en la tarjeta del próximo viaje de Inicio. Errores de php/booking_traveler_api.php?action=reservation_pay.
// Texts in jvariables page 'cuenta_viajero' (page created if missing, existing variables skipped; same approach as
// SeedPanelSmallGapsVariables1791400000008). Only description_l1 exists in v4p_jvariables1 (utf8 3-byte: no emojis);
// other languages come from jclientes_translations. {fecha} is replaced by JS, which also carries Spanish fallbacks
// while this seed is pending. down deletes only these keys.
const CUSTOMER = "v4p";
const PAGE = "cuenta_viajero";

/** [variable, description_l1] */
type SeedVariable = readonly [variable: string, text: string];

const VARIABLES: readonly SeedVariable[] = [
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
];

export class SeedPanelPayPendingVariables1791400000009 implements MigrationInterface {
  name = "SeedPanelPayPendingVariables1791400000009";

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
