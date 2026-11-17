import type { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Host profile mode per accommodation:
//   legacy  = classic profile ("Actualizar perfil", leads by email), no bookings
//   booking = booking system (wizard + "Reservas" tab)
// Every existing site stays legacy (column default). V4P switches it by hand in
// admino > ALOJAMIENTOS V4P (CON FICHA) > MODO PERFIL (jtables row below).
// PHP reads it in web/inc/site_profile_mode_lib.php.
const TABLE = "v4p_jsites1";
const JTABLES = "v4p_jtables";
const CUSTOMER = "v4p";
const DBTABLE = "jsites1";
const NAMESQL = "profile_mode";

export class SiteProfileMode1791500000012 implements MigrationInterface {
  name = "SiteProfileMode1791500000012";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner))) {
      await queryRunner.query(
        `ALTER TABLE \`${TABLE}\`
           ADD COLUMN \`${NAMESQL}\` varchar(10) NOT NULL DEFAULT 'legacy'`,
      );
    }

    await queryRunner.query(
      `INSERT INTO \`${JTABLES}\`
         (\`customer\`, \`dbtable\`, \`sequence\`, \`type\`, \`namesql\`, \`name\`, \`label\`,
          \`description\`, \`required\`, \`width\`, \`height\`, \`style\`, \`can_add_columns\`,
          \`is_generated\`, \`section\`, \`icon\`, \`validation_type\`)
       SELECT ?, ?, 62, 'manualoption', ?, ?, '', ?, 'legacy|booking', 0, 0, '', 0, 0, '', '', ''
       FROM DUAL
       WHERE NOT EXISTS (
         SELECT 1 FROM \`${JTABLES}\`
          WHERE \`customer\` = ? AND \`dbtable\` = ? AND \`namesql\` = ?
       )`,
      [
        CUSTOMER,
        DBTABLE,
        NAMESQL,
        "MODO PERFIL (legacy = clásico sin reservas · booking = sistema de reservas)",
        "booking oculta Perfil/Fotos/Descuentos/Mensajes y muestra Reservas + pestañas de viajero. Pásalo a booking cuando el alojamiento haya enviado el registro del wizard y lo hayas revisado.",
        CUSTOMER,
        DBTABLE,
        NAMESQL,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM \`${JTABLES}\` WHERE \`customer\` = ? AND \`dbtable\` = ? AND \`namesql\` = ?`,
      [CUSTOMER, DBTABLE, NAMESQL],
    );
    if (await this.columnExists(queryRunner)) {
      await queryRunner.query(
        `ALTER TABLE \`${TABLE}\` DROP COLUMN \`${NAMESQL}\``,
      );
    }
  }

  private async columnExists(queryRunner: QueryRunner): Promise<boolean> {
    const rows = (await queryRunner.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
      [TABLE, NAMESQL],
    )) as unknown[];
    return rows.length > 0;
  }
}
