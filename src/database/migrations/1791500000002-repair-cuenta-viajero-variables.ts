import { MigrationInterface, QueryRunner } from "typeorm";

// Re-aplica idempotentemente SeedCuentaViajeroVariables1791200000001 cuando la migración
// original ya está en `migrations` pero faltan filas en v4p_jvariables1 (p. ej. inserts
// parciales o BD restaurada sin textos). Solo inserta claves ausentes; no modifica las existentes.
const CUSTOMER = "v4p";

type SeedVariable = readonly [variable: string, text: string, link?: string];

interface SeedPage {
  page: string;
  variables: readonly SeedVariable[];
}

const CUENTA_VIAJERO_VARIABLES: readonly SeedVariable[] = [
  ["cv_titulo", "Mi cuenta"],
  ["cv_saludo", "Hola, {name}"],
  ["cv_nav_menu", "Menú de mi cuenta"],
  ["cv_nav_inicio", "Inicio"],
  ["cv_nav_reservas", "Mis reservas"],
  ["cv_nav_perros", "Mis perros"],
  ["cv_nav_club", "Club 4Patas"],
  ["cv_nav_perfil", "Mi perfil"],
  ["cv_nav_ayuda", "Ayuda"],
  ["cv_nav_ayuda_link", "Ayuda", "contacto"],
  ["cv_nav_club_link", "Club 4Patas", "club4patas"],
  ["cv_nav_cerrar", "Cerrar sesión"],
  ["cv_club_puntos_placeholder", "Próximamente: puntos Club"],
  ["cv_club_ver", "Conocer el Club 4Patas"],
  ["cv_proximamente", "Esta sección estará disponible muy pronto."],
  ["cv_cargando", "Cargando…"],
  ["cv_tab_proximas", "Próximas"],
  ["cv_tab_pasadas", "Pasadas"],
  ["cv_tab_canceladas", "Canceladas"],
  ["cv_empty_proximas", "No tienes reservas próximas."],
  ["cv_empty_pasadas", "Todavía no tienes reservas pasadas."],
  ["cv_empty_canceladas", "No tienes reservas canceladas."],
  ["cv_card_ver_detalle", "Ver detalle"],
  ["cv_card_viajeros", "Viajeros"],
  ["cv_card_perros", "Perros"],
  ["cv_card_total", "Total"],
  ["cv_card_noches", "{n} noches"],
  ["cv_card_noche_una", "1 noche"],
  ["cv_cargar_mas", "Cargar más"],
  ["cv_error_carga", "No se pudo cargar la información. Inténtalo de nuevo."],
  ["cv_status_cancelled", "Cancelada"],
  ["cv_status_incident_review", "Incidencia en revisión"],
  ["cv_status_finalized", "Estancia finalizada"],
  ["cv_status_payment_pending", "Pago pendiente"],
  ["cv_status_confirmed", "Confirmada"],
  ["cv_status_in_progress", "En proceso"],
  ["cv_pay_paid", "Pagado"],
  ["cv_pay_failed", "Pago no completado"],
  ["cv_pay_pending", "Pago pendiente"],
  ["cv_ref_pending", "Pendiente de revisión V4P"],
  ["cv_ref_processing", "Reembolso en curso"],
  ["cv_ref_completed", "Reembolso completado"],
  ["cv_ref_failed", "Reembolso no completado"],
  ["cv_det_volver", "Volver a mis reservas"],
  ["cv_det_estancia", "Estancia"],
  ["cv_det_checkin", "Entrada"],
  ["cv_det_checkout", "Salida"],
  ["cv_det_noches", "Noches"],
  ["cv_det_unidad", "Unidad"],
  ["cv_det_regimen", "Régimen"],
  ["cv_det_perros_declarados", "Perros declarados"],
  ["cv_det_sin_perros", "No declaraste perros en esta reserva."],
  ["cv_det_peso", "{kg} kg"],
  ["cv_det_perro_ppp", "PPP"],
  ["cv_det_dogfriendly", "Condiciones Dog Friendly contratadas"],
  ["cv_det_max_perros", "Máximo de perros"],
  ["cv_det_sin_limite", "Sin límite"],
  ["cv_det_tallas", "Tallas admitidas"],
  ["cv_det_tallas_todas", "Todas las tallas"],
  ["cv_det_ppp_admitidos", "Perros PPP admitidos"],
  ["cv_det_solos", "Puede quedarse solo en la unidad"],
  ["cv_det_solos_condicional", "Con condiciones"],
  ["cv_det_si", "Sí"],
  ["cv_det_no", "No"],
  ["cv_det_zonas", "Zonas comunes permitidas"],
  ["cv_det_zona_comer", "también para comer"],
  ["cv_det_notas", "Notas del alojamiento"],
  ["cv_det_fianza", "Fianza"],
  [
    "cv_det_fianza_info",
    "La fianza la gestiona directamente el alojamiento. Viajes 4Patas no la cobra.",
  ],
  ["cv_det_desglose", "Desglose del precio"],
  ["cv_det_total", "Total"],
  ["cv_det_politica", "Política de cancelación"],
  ["cv_det_deadline", "Cancelación con reembolso hasta"],
  [
    "cv_det_politica_legacy",
    "Puedes cancelar con reembolso del importe pagado hasta la fecha límite indicada. Después de esa fecha la cancelación no tiene reembolso.",
  ],
  ["cv_det_documentos", "Documentos"],
  ["cv_det_condiciones_aceptadas", "Condiciones aceptadas"],
  ["cv_det_historial_pagos", "Historial de pagos y reembolsos"],
  ["cv_det_pago", "Pago"],
  ["cv_det_reembolso", "Reembolso"],
  ["cv_det_sin_movimientos", "Todavía no hay movimientos en esta reserva."],
  ["cv_det_valorar", "Valorar estancia"],
  ["cv_det_valorada", "Estancia valorada. ¡Gracias!"],
  ["cv_det_valorar_vencida", "El plazo para valorar esta estancia ha terminado."],
  [
    "cv_det_valorar_no_disponible",
    "La valoración ya no está disponible: ya la enviaste o el plazo ha terminado.",
  ],
  ["cv_det_valorar_error", "No se pudo abrir la valoración. Inténtalo de nuevo."],
];

const MENU_VARIABLES: readonly SeedVariable[] = [
  ["cambiarperfil_mis_viajes", "Mis viajes"],
];

const PAGES: readonly SeedPage[] = [
  { page: "cuenta_viajero", variables: CUENTA_VIAJERO_VARIABLES },
  { page: "menu", variables: MENU_VARIABLES },
];

export class RepairCuentaViajeroVariables1791500000002
  implements MigrationInterface
{
  name = "RepairCuentaViajeroVariables1791500000002";

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
