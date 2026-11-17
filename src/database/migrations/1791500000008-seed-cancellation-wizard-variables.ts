import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Wizard step 6 "Política de cancelación" UI texts
// into the existing jvariables page 'registraralojamiento' (same approach as
// SeedSteps5To7Variables1790900000007: existing variables are skipped;
// down deletes only these keys, never the page).
const CUSTOMER = "v4p";
const PAGE = "registraralojamiento";

const VARIABLES: readonly (readonly [string, string])[] = [
  ["fsc_s6_cancel_title", "Política de cancelación"],
  [
    "fsc_s6_cancel_intro",
    "Elige qué ocurre si el viajero cancela. Antes de reservar verá un resumen claro con fechas y horas.",
  ],
  ["fsc_s6_cancel_saved", "Política de cancelación guardada"],
  ["fsc_s6_ctype", "Tipo de tarifa"],
  ["fsc_s6_ctype_free", "Cancelación gratuita"],
  ["fsc_s6_ctype_partial", "Parcialmente reembolsable"],
  ["fsc_s6_ctype_nonref", "No reembolsable"],
  [
    "fsc_s6_ctype_free_help",
    "El viajero puede cancelar sin coste hasta el plazo que elijas.",
  ],
  [
    "fsc_s6_ctype_partial_help",
    "Se cobra al reservar. Si el viajero cancela, se le devuelve una parte.",
  ],
  [
    "fsc_s6_ctype_nonref_help",
    "Se cobra al reservar y no se devuelve nada si el viajero cancela.",
  ],
  [
    "fsc_s6_cdays",
    "¿Hasta cuántos días antes de la llegada pueden cancelar gratis?",
  ],
  ["fsc_s6_cdays_1", "1 día"],
  ["fsc_s6_cdays_3", "3 días"],
  ["fsc_s6_cdays_7", "7 días"],
  ["fsc_s6_cdays_14", "14 días"],
  ["fsc_s6_cdays_30", "30 días"],
  [
    "fsc_s6_cdays_help",
    "El plazo termina a las 18:00 (hora del alojamiento) de ese día.",
  ],
  ["fsc_s6_cpenalty_free", "Si cancelan después del plazo, se cobra"],
  ["fsc_s6_cpenalty_partial", "Si cancelan después de reservar, se cobra"],
  ["fsc_s6_cpenalty_50", "50 %"],
  ["fsc_s6_cpenalty_first_night", "Primera noche"],
  ["fsc_s6_cpenalty_100", "100 %"],
  ["fsc_s6_cnoshow", "Si el viajero no se presenta"],
  ["fsc_s6_cnoshow_same", "Igual que la cancelación"],
  ["fsc_s6_cnoshow_full", "100 % del total"],
  ["fsc_s6_cexc", "Excepciones"],
  ["fsc_s6_cgrace", "Cancelación gratuita durante las primeras"],
  ["fsc_s6_cgrace_aria", "Horas tras reservar"],
  ["fsc_s6_cgrace_1", "1 hora"],
  ["fsc_s6_cgrace_4", "4 horas"],
  ["fsc_s6_cgrace_24", "24 horas"],
  ["fsc_s6_cgrace_after", "tras reservar"],
  ["fsc_s6_cearly", "Cancelación gratuita si cancelan con"],
  ["fsc_s6_cearly_aria", "Semanas de antelación"],
  ["fsc_s6_cearly_4", "4 semanas"],
  ["fsc_s6_cearly_8", "8 semanas"],
  ["fsc_s6_cearly_12", "12 semanas"],
  ["fsc_s6_cearly_after", "o más de antelación"],
  ["fsc_s6_ctz", "Zona horaria del alojamiento"],
  ["fsc_s6_ctz_madrid", "Península y Baleares"],
  ["fsc_s6_ctz_canary", "Canarias"],
  ["fsc_s6_ctz_label_madrid", "Madrid"],
  ["fsc_s6_ctz_label_canary", "Canarias"],
  ["fsc_s6_cprev_title", "Así lo verá el viajero (ejemplo)"],
  [
    "fsc_s6_cprev_free",
    "Si llegan el {checkin}, cancelación gratuita hasta el {deadline} a las {time} (hora de {tz}). Después se cobra {penalty}.",
  ],
  ["fsc_s6_cprev_free_charge", "Se cobra el total al llegar el plazo."],
  [
    "fsc_s6_cprev_free_charge_now",
    "Se cobra el total al reservar y, si cancelan, se devuelve según esta política.",
  ],
  [
    "fsc_s6_cprev_partial",
    "Se cobra el 100 % al reservar. Si cancelan, se retiene {penalty} y se devuelve el resto.",
  ],
  [
    "fsc_s6_cprev_nonref",
    "Se cobra el 100 % al reservar. Si cancelan, no se devuelve nada.",
  ],
  ["fsc_s6_cprev_noshow_same", "Si no se presentan, se cobra {penalty}."],
  [
    "fsc_s6_cprev_noshow_full",
    "Si no se presentan, se cobra el 100 % del total.",
  ],
  [
    "fsc_s6_cprev_grace",
    "Excepción: cancelación gratuita durante las primeras {n} h tras reservar.",
  ],
  [
    "fsc_s6_cprev_early",
    "Excepción: cancelación gratuita si cancelan con {n} semanas o más de antelación.",
  ],
  ["fsc_s6_cprev_pen_50", "el 50 %"],
  ["fsc_s6_cprev_pen_first_night", "la primera noche"],
  ["fsc_s6_cprev_pen_100", "el 100 %"],
  ["fsc_s6_need_ctype", "Elige una política de cancelación."],
  ["fsc_s6_need_cdays", "Elige hasta cuándo se puede cancelar gratis."],
  ["fsc_s6_need_cpenalty", "Elige cuánto se cobra si cancelan."],
  ["fsc_s6_need_cgrace", "Elige las horas."],
  ["fsc_s6_need_cearly", "Elige las semanas."],
  ["fsc_s6_need_ctz", "Elige la zona horaria."],
];

export class SeedCancellationWizardVariables1791500000008 implements MigrationInterface {
  name = "SeedCancellationWizardVariables1791500000008";

  public async up(queryRunner: QueryRunner): Promise<void> {
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
