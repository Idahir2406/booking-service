import type { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Admin section for the user profiles table
// (hosts + travelers): admSelect.php -> "USUARIOS" ->
// jGlobal_data.php?dbtable=juser_profiles.
//
// - The admino engine (jGlobal_data/form/updb) always filters by and writes
//   `customer = 'v4p'`, but v4p_juser_profiles had no `customer` column. It is
//   added as NOT NULL DEFAULT 'v4p' so existing rows and every insert from the
//   PHP site / booking (which don't send it) land under 'v4p' unchanged.
// - jGlobal_updb.php writes EVERY registered field back as a quoted string, so
//   a NULL becomes ''. Therefore these columns are deliberately NOT registered:
//     password             (encrypted login secret, never exposed)
//     stripe_account_id    ('' is not null -> booking would use '' as the
//                           connected account id; see stripe.service.ts)
//     marketing_opt_in_at, updated_at (DATETIME: '' fails in strict mode)
// - Full CRUD ('abcd') as requested. Deleting a user that is referenced by a
//   FK (fk_user -> user_id) is rejected by MySQL; admino does not report it.
const TABLE = "v4p_juser_profiles";
const JTABLES = "v4p_jtables";
const CUSTOMER = "v4p";
const DBTABLE = "juser_profiles";

/** [sequence, type, namesql, name, description, required, width, height, style, validation_type] */
type JtablesRow = readonly [
  sequence: number,
  type: string,
  namesql: string,
  name: string,
  description: string,
  required: string,
  width: number,
  height: number,
  style: string,
  validationType: string,
];

const JTABLES_ROWS: readonly JtablesRow[] = [
  [
    0,
    "table",
    TABLE,
    "PERFILES DE USUARIO",
    "Usuarios de la web (anfitriones y viajeros). La contraseña, la cuenta Stripe y las fechas no se editan desde aquí.",
    "abcd",
    0,
    0,
    "",
    "",
  ],
  [
    10,
    "email",
    "email",
    "EMAIL (login, único)",
    "Email de acceso. Es único: si ya existe otro usuario con el mismo email no se guarda.",
    "required",
    255,
    0,
    "asc",
    "",
  ],
  [11, "manualoption", "role", "ROL", "", "customer|host", 0, 0, "", ""],
  [12, "text", "name", "NOMBRE", "", "", 0, 0, "", ""],
  [13, "text", "surname", "APELLIDOS", "", "", 120, 0, "", ""],
  [14, "text", "phone", "TELÉFONO", "", "", 32, 0, "", ""],
  [
    15,
    "text",
    "avatar_path",
    "AVATAR (ruta)",
    "Lo gestiona el panel del viajero.",
    "readonly",
    255,
    0,
    "",
    "",
  ],
  [
    16,
    "manualoption",
    "marketing_opt_in",
    "ACEPTA MARKETING (1 = sí)",
    "Consentimiento RGPD. Solo cambiar a petición del usuario.",
    "0|1",
    0,
    0,
    "",
    "",
  ],
];

export class JuserProfilesAdmino1791500000010 implements MigrationInterface {
  name = "JuserProfilesAdmino1791500000010";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner, "customer"))) {
      await queryRunner.query(
        `ALTER TABLE \`${TABLE}\`
           ADD COLUMN \`customer\` varchar(99) NOT NULL DEFAULT '${CUSTOMER}',
           ADD KEY \`i_juser_profiles_customer\` (\`customer\`)`,
      );
    }

    for (const [
      sequence,
      type,
      namesql,
      name,
      description,
      required,
      width,
      height,
      style,
      validationType,
    ] of JTABLES_ROWS) {
      await queryRunner.query(
        `INSERT INTO \`${JTABLES}\`
           (\`customer\`, \`dbtable\`, \`sequence\`, \`type\`, \`namesql\`, \`name\`, \`label\`,
            \`description\`, \`required\`, \`width\`, \`height\`, \`style\`, \`can_add_columns\`,
            \`is_generated\`, \`section\`, \`icon\`, \`validation_type\`)
         SELECT ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, 0, 0, '', '', ?
         FROM DUAL
         WHERE NOT EXISTS (
           SELECT 1 FROM \`${JTABLES}\`
            WHERE \`customer\` = ? AND \`dbtable\` = ? AND \`type\` = ?
              AND \`namesql\` = ? AND \`name\` = ?
         )`,
        [
          CUSTOMER,
          DBTABLE,
          sequence,
          type,
          namesql,
          name,
          description,
          required,
          width,
          height,
          style,
          validationType,
          CUSTOMER,
          DBTABLE,
          type,
          namesql,
          name,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM \`${JTABLES}\` WHERE \`customer\` = ? AND \`dbtable\` = ?`,
      [CUSTOMER, DBTABLE],
    );
    if (await this.columnExists(queryRunner, "customer")) {
      await queryRunner.query(
        `ALTER TABLE \`${TABLE}\`
           DROP KEY \`i_juser_profiles_customer\`,
           DROP COLUMN \`customer\``,
      );
    }
  }

  private async columnExists(
    queryRunner: QueryRunner,
    column: string,
  ): Promise<boolean> {
    const rows = (await queryRunner.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
      [TABLE, column],
    )) as unknown[];
    return rows.length > 0;
  }
}
