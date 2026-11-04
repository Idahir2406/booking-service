import { MigrationInterface, QueryRunner } from "typeorm";

// Re-aplica idempotentemente textos de pestañas del panel viajero cuando las migraciones originales
// ya están en `migrations` pero faltan filas en v4p_jvariables1:
//   - SeedInicioVariables1791300000003 (tv_inicio → cv_home_*)
//   - SeedPerrosPerfilVariables1791300000002 (tv_perros, tv_perfil → cv_dogs_*, cv_prof_*, cv_pwd_*)
//   - SeedIncidentsTabVariables1791400000012 (pestaña incidencias → cv_inc_inbox_*, etc.)
//   - SeedPanelSmallGapsVariables1791400000008 (comunicaciones en Mi perfil → cv_comms_*)
const CUSTOMER = "v4p";
const PAGE = "cuenta_viajero";

type SeedVariable = readonly [variable: string, text: string, link?: string];

const VARIABLES: readonly SeedVariable[] = [
  // --- Inicio (1791300000003) ---
  ["cv_home_saludo", "Hola, {name}"],
  [
    "cv_home_intro",
    "Aquí tienes lo más importante de tus viajes con tu perro.",
  ],
  ["cv_home_proximo", "Tu próximo viaje"],
  ["cv_home_proximas_total", "Tienes {n} viajes próximos"],
  ["cv_home_ver_reservas", "Ver todas mis reservas"],
  [
    "cv_home_sin_viajes",
    "No tienes ningún viaje próximo. ¿Buscamos tu próxima escapada con tu perro?",
  ],
  [
    "cv_home_buscar",
    "Buscar alojamientos",
    "alojamientos-admiten-perros-destino/todos-los-destinos",
  ],
  ["cv_home_perros", "Tus perros"],
  [
    "cv_home_sin_perros",
    "Aún no has guardado a tu perro. Guárdalo para tener sus datos a mano.",
  ],
  ["cv_home_add_perro", "Añadir perro"],
  ["cv_home_ver_perros", "Gestionar mis perros"],
  ["cv_home_avisos", "Avisos"],
  ["cv_alert_free_cancel", "Puedes cancelar gratis hasta el {fecha}."],
  [
    "cv_alert_incident",
    "Tienes una incidencia en revisión. V4P te informará de la resolución.",
  ],
  [
    "cv_alert_proposal",
    "Tienes una propuesta de cambio pendiente de respuesta.",
  ],
  [
    "cv_alert_alternative",
    "Tienes una alternativa de alojamiento pendiente de respuesta.",
  ],
  ["cv_alert_ver", "Ver reserva"],
  [
    "cv_home_error",
    "No hemos podido cargar tu resumen. Recarga la página para intentarlo de nuevo.",
  ],
  // --- Mis perros + Mi perfil (1791300000002) ---
  ["cv_guardando", "Guardando…"],
  ["cv_dogs_titulo", "Mis perros"],
  [
    "cv_dogs_empty",
    "Todavía no has guardado ningún perro. Añádelo para tener sus datos a mano.",
  ],
  ["cv_dogs_add", "Añadir perro"],
  ["cv_dogs_edit", "Editar perro"],
  ["cv_dogs_delete", "Eliminar"],
  [
    "cv_dogs_delete_confirm",
    "¿Seguro que quieres eliminar a {name} de tus perros?",
  ],
  ["cv_dogs_deleted", "Perro eliminado."],
  ["cv_dogs_name", "Nombre"],
  ["cv_dogs_weight", "Peso (kg)"],
  [
    "cv_dogs_weight_help",
    "Entre 0,5 y 120 kg. Con el peso calculamos su talla.",
  ],
  ["cv_dogs_kg", "{kg} kg"],
  ["cv_dogs_size", "Talla"],
  ["cv_dogs_ppp", "Es un perro potencialmente peligroso (PPP)"],
  [
    "cv_dogs_ppp_help",
    "Marca esta opción si tu perro está catalogado como PPP según la normativa. Algunos alojamientos no los admiten.",
  ],
  ["cv_dogs_ppp_tag", "PPP"],
  ["cv_dogs_photo", "Foto"],
  ["cv_dogs_photo_change", "Elegir foto"],
  ["cv_dogs_photo_remove", "Quitar foto"],
  [
    "cv_dogs_max",
    "Has llegado al máximo de perros guardados. Elimina alguno para añadir otro.",
  ],
  [
    "cv_dogs_snapshot_aviso",
    "Los cambios no afectan a reservas ya hechas: cada reserva conserva los datos del perro con los que se hizo.",
  ],
  ["cv_dogs_saved", "Perro guardado."],
  ["cv_dogs_error", "No se pudo guardar. Inténtalo de nuevo."],
  [
    "cv_dogs_error_nombre",
    "Escribe el nombre del perro (máximo 60 caracteres).",
  ],
  ["cv_dogs_error_peso", "Indica un peso entre 0,5 y 120 kg."],
  ["cv_dogs_guardar", "Guardar"],
  ["cv_dogs_cancelar", "Cancelar"],
  ["cv_img_formatos", "JPG, PNG o WebP. Máximo 5 MB."],
  [
    "cv_img_error_tipo",
    "Formato no admitido. Sube una imagen JPG, PNG o WebP.",
  ],
  [
    "cv_img_error_size",
    "La imagen es demasiado grande. El máximo son 5 MB.",
  ],
  ["cv_prof_titulo", "Mi perfil"],
  ["cv_prof_avatar", "Foto de perfil"],
  ["cv_prof_avatar_change", "Cambiar foto"],
  ["cv_prof_avatar_remove", "Quitar foto"],
  ["cv_prof_avatar_saved", "Foto de perfil actualizada."],
  ["cv_prof_datos", "Datos personales"],
  ["cv_prof_name", "Nombre"],
  ["cv_prof_surname", "Apellidos"],
  ["cv_prof_email", "Email"],
  [
    "cv_prof_email_ro",
    "El email es tu usuario de acceso y no se puede cambiar desde aquí.",
  ],
  ["cv_prof_phone", "Teléfono"],
  [
    "cv_prof_phone_help",
    "Opcional. Solo números y espacios, con prefijo + si quieres.",
  ],
  ["cv_prof_guardar", "Guardar cambios"],
  ["cv_prof_saved", "Datos guardados."],
  ["cv_prof_error", "No se pudieron guardar los datos. Inténtalo de nuevo."],
  ["cv_prof_error_nombre", "Escribe tu nombre (máximo 80 caracteres)."],
  ["cv_prof_error_telefono", "El teléfono no es válido."],
  ["cv_pwd_titulo", "Cambiar contraseña"],
  ["cv_pwd_desc", "Por seguridad te pedimos tu contraseña actual."],
  ["cv_pwd_actual", "Contraseña actual"],
  ["cv_pwd_nueva", "Nueva contraseña"],
  ["cv_pwd_repetir", "Repite la nueva contraseña"],
  ["cv_pwd_requisitos", "Mínimo 8 caracteres, con letras y números."],
  ["cv_pwd_mostrar", "Mostrar contraseñas"],
  ["cv_pwd_guardar", "Cambiar contraseña"],
  ["cv_pwd_ok", "Tu contraseña se ha cambiado."],
  ["cv_pwd_error", "No se pudo cambiar la contraseña. Inténtalo de nuevo."],
  ["cv_pwd_error_actual", "La contraseña actual no es correcta."],
  [
    "cv_pwd_error_igual",
    "La nueva contraseña debe ser distinta de la actual.",
  ],
  [
    "cv_pwd_error_longitud",
    "La nueva contraseña debe tener entre 8 y 72 caracteres.",
  ],
  ["cv_pwd_error_debil", "La nueva contraseña debe incluir letras y números."],
  ["cv_pwd_error_distintas", "Las contraseñas nuevas no coinciden."],
  [
    "cv_pwd_error_intentos",
    "Demasiados intentos fallidos. Espera unos minutos y vuelve a intentarlo.",
  ],
  ["cv_pwd_fuerza_debil", "Contraseña débil"],
  ["cv_pwd_fuerza_normal", "Contraseña normal"],
  ["cv_pwd_fuerza_fuerte", "Contraseña fuerte"],
  ["cv_pwd_fuerza_muy_fuerte", "Contraseña muy fuerte"],
  // --- Incidencias (1791400000012, cuenta_viajero) ---
  ["cv_nav_incidencias", "Incidencias"],
  [
    "cv_inc_inbox_intro",
    "Aquí tienes todas tus incidencias, agrupadas por alojamiento. Cada mensaje te llega también por email.",
  ],
  ["cv_inc_inbox_vacio", "Todavía no tienes incidencias."],
  [
    "cv_inc_inbox_vacio_hint",
    "Las incidencias se abren desde el detalle de cada reserva.",
  ],
  ["cv_inc_inbox_ir_reservas", "Ir a mis reservas"],
  [
    "cv_inc_inbox_error",
    "No hemos podido cargar tus incidencias. Inténtalo de nuevo.",
  ],
  ["cv_inc_alojamiento", "Alojamiento"],
  ["cv_inc_ultima_actividad", "Última actividad: {fecha}"],
  ["cv_inc_contador", "{mensajes} mensajes · {adjuntos} adjuntos"],
  ["cv_inc_estancia", "Estancia: {fechas}"],
  ["cv_inc_volver_bandeja", "Volver a incidencias"],
  ["cv_inc_ver_conversacion", "Ver conversación"],
  ["cv_inc_conversacion", "Conversación"],
  ["cv_inc_descripcion_inicial", "Incidencia abierta"],
  ["cv_inc_adjuntos_titulo", "Adjuntos"],
  ["cv_inc_chat_label", "Tu mensaje"],
  ["cv_inc_chat_placeholder", "Escribe tu mensaje"],
  ["cv_inc_chat_enviar", "Enviar mensaje"],
  [
    "cv_inc_chat_enviado",
    "Mensaje enviado. Te enviaremos una copia por email.",
  ],
  [
    "cv_inc_chat_email_hint",
    "Te enviaremos una copia de cada mensaje por email.",
  ],
  [
    "cv_inc_chat_vacio_error",
    "Escribe un mensaje o adjunta un archivo.",
  ],
  [
    "cv_inc_chat_closed_error",
    "La incidencia se ha cerrado y ya no admite mensajes.",
  ],
  [
    "cv_inc_chat_cerrada",
    "Esta incidencia está resuelta y ya no admite mensajes. Si necesitas algo más, abre una nueva desde el detalle de la reserva.",
  ],
  [
    "cv_inc_detalle_error",
    "No hemos podido cargar la conversación.",
  ],
  // --- Comunicaciones en Mi perfil (1791400000008) ---
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
];

export class RepairTravelerTabVariables1791500000003
  implements MigrationInterface
{
  name = "RepairTravelerTabVariables1791500000003";

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
