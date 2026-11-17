import { MigrationInterface, QueryRunner } from "typeorm";

// El registro de socio termina al crear la cuenta: no hay verificación por email.
// El toast de php/socregister_body.php ya no pide revisar el correo.
const CUSTOMER = "v4p";
const VARIABLE = "socregister_ok";
const TRANSLATIONS_TABLE = "v4p_jvariables1";

const BASE_NEW = "¡Te has registrado con éxito! Ya puedes iniciar sesión.";
const BASE_OLD = "¡Cuenta creada! Revisa tu email.";

const TRANSLATIONS: readonly (readonly [
  lang: string,
  newText: string,
  oldText: string,
])[] = [
  [
    "en",
    "You have registered successfully! You can now log in.",
    "Account created! Check your email.",
  ],
  [
    "fr",
    "Votre inscription a bien été effectuée ! Vous pouvez maintenant vous connecter.",
    "Compte créé ! Vérifiez votre email.",
  ],
  [
    "pt",
    "O seu registo foi concluído com sucesso! Já pode iniciar sessão.",
    "Conta criada! Verifique o seu email.",
  ],
  [
    "ca",
    "T'has registrat amb èxit! Ja pots iniciar sessió.",
    "Compte creat! Revisa el teu email.",
  ],
];

export class UpdateSocregisterOkText1791500000005
  implements MigrationInterface
{
  name = "UpdateSocregisterOkText1791500000005";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.setBase(queryRunner, BASE_NEW);
    for (const [lang, newText] of TRANSLATIONS) {
      await this.setTranslation(queryRunner, lang, newText);
    }
  }

  // Las filas duplicadas tenían variantes del texto antiguo: se restaura una sola versión por idioma.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.setBase(queryRunner, BASE_OLD);
    for (const [lang, , oldText] of TRANSLATIONS) {
      await this.setTranslation(queryRunner, lang, oldText);
    }
  }

  private async setBase(queryRunner: QueryRunner, text: string): Promise<void> {
    await queryRunner.query(
      `UPDATE \`v4p_jvariables1\` SET \`description_l1\` = ? WHERE \`customer\` = ? AND \`variable\` = ?`,
      [text, CUSTOMER, VARIABLE],
    );
  }

  private async setTranslation(
    queryRunner: QueryRunner,
    lang: string,
    text: string,
  ): Promise<void> {
    await queryRunner.query(
      `UPDATE \`v4p_jclientes_translations\` SET \`value\` = ? WHERE \`table_name\` = ? AND \`field\` = ? AND \`lang\` = ?`,
      [text, TRANSLATIONS_TABLE, VARIABLE, lang],
    );
  }
}
