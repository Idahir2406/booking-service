import type {
  BuiltReservationEmail,
  ReservationEmailPayload,
  ReservationEmailType,
} from "../types/reservation-email.types";

import { Injectable, Logger } from "@nestjs/common";

import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";

type VbleMap = Record<string, string>;

interface ReservationBlock {
  resCode: string;
  totalFmt: string;
  html: string;
}

interface DispatchConfig {
  subjectKey: string;
  subjectFallback: string;
  introKey: string;
  introFallback: string;
  outroKey?: string;
  outroFallback?: string;
  roleLabel: string;
  extraHtml?: string;
}

interface JvariableRow {
  variable: string;
  value: string;
}

interface TranslationRow {
  field: string;
  value: string;
}

@Injectable()
export class ReservationEmailTemplateService {
  private readonly logger = new Logger(ReservationEmailTemplateService.name);

  constructor(private readonly mysqlService: MysqlService) {}

  async build(
    emailType: ReservationEmailType,
    payload: ReservationEmailPayload,
    customer: string,
  ): Promise<BuiltReservationEmail | null> {
    const vble = await this.loadReservationVble(customer);
    const block = this.formatReservationBlock(payload, vble);
    const guestEmail = (payload.guest_email ?? "").trim();
    const hostEmail = (payload.host_email ?? "").trim();
    const adminEmail = (payload.admin_email ?? envs.BOOKING_ADMIN_EMAIL).trim();

    const dispatch = (
      to: string,
      config: DispatchConfig,
    ): BuiltReservationEmail | null => {
      if (to === "") {
        this.logger.warn(
          `Email ${emailType} skipped for reservation #RES-${payload.reservation_id}: missing recipient (${config.roleLabel})`,
        );
        return null;
      }
      const body = this.buildBody(vble, block, config);
      const subject =
        this.text(config.subjectKey, config.subjectFallback, vble) +
        " " +
        block.resCode;
      return {
        to,
        subject,
        html: body,
        roleLabel: config.roleLabel,
      };
    };

    switch (emailType) {
      case "payment_confirmed_guest": {
        return dispatch(guestEmail, {
          subjectKey: "nrf_email_subject",
          subjectFallback: "Confirmación de reserva",
          introKey: "nrf_email_guest_intro",
          introFallback: "Tu reserva ha sido confirmada.",
          roleLabel: "huésped",
        });
      }

      case "payment_confirmed_host": {
        return dispatch(hostEmail, {
          subjectKey: "nrf_email_subject",
          subjectFallback: "Nueva reserva",
          introKey: "nrf_email_host_intro",
          introFallback: "Has recibido una nueva reserva.",
          outroKey: "nrf_email_host_outro",
          outroFallback: "Revisa la reserva en tu panel.",
          roleLabel: "anfitrión",
        });
      }

      case "cancelled_guest_refund": {
        const extra = this.text(
          "tab_reservas_email_cancel_refund_note",
          "Se ha procesado el reembolso.",
          vble,
        );
        return dispatch(guestEmail, {
          subjectKey: "tab_reservas_email_cancel_subject",
          subjectFallback: "Reserva cancelada",
          introKey: "tab_reservas_email_cancel_guest_intro",
          introFallback: "Tu reserva ha sido cancelada.",
          roleLabel: "huésped",
          extraHtml: `<p>${this.escapeHtml(extra)}</p><br>`,
        });
      }

      case "cancelled_guest_no_refund": {
        return dispatch(guestEmail, {
          subjectKey: "tab_reservas_email_cancel_subject",
          subjectFallback: "Reserva cancelada",
          introKey: "tab_reservas_email_cancel_guest_norefund_intro",
          introFallback: "Tu reserva ha sido cancelada sin reembolso.",
          roleLabel: "huésped",
        });
      }

      case "cancelled_host": {
        return dispatch(hostEmail, {
          subjectKey: "tab_reservas_email_cancel_subject",
          subjectFallback: "Reserva cancelada",
          introKey: "tab_reservas_email_cancel_host_intro",
          introFallback: "Una reserva ha sido cancelada.",
          roleLabel: "anfitrión",
        });
      }

      case "finalized_guest_feedback": {
        const feedbackUrl = (payload.feedback_url ?? "").trim();
        let linkHtml = "";
        if (feedbackUrl !== "") {
          const linkLabel = this.text(
            "nrf_feedback_link_label",
            "Valorar tu estancia",
            vble,
          );
          linkHtml = `<p><a href="${this.escapeHtml(feedbackUrl)}">${this.escapeHtml(linkLabel)}</a></p><br>`;
        }
        return dispatch(guestEmail, {
          subjectKey: "nrf_feedback_email_subject",
          subjectFallback: "Cuéntanos tu experiencia",
          introKey: "nrf_feedback_email_intro",
          introFallback:
            "Tu estancia ha finalizado. Valora o reporta incidencias.",
          roleLabel: "huésped",
          extraHtml: linkHtml,
        });
      }

      case "finalized_host": {
        return dispatch(hostEmail, {
          subjectKey: "tab_reservas_email_finalize_subject",
          subjectFallback: "Estancia finalizada",
          introKey: "tab_reservas_email_finalize_host_intro",
          introFallback:
            "Has finalizado la estancia. El huésped tiene 24h para valorar.",
          roleLabel: "anfitrión",
        });
      }

      case "feedback_review_guest": {
        return dispatch(guestEmail, {
          subjectKey: "nrf_feedback_email_thanks_subject",
          subjectFallback: "Gracias por tu valoración",
          introKey: "nrf_feedback_email_thanks_intro",
          introFallback: "Hemos recibido tu valoración. ¡Gracias!",
          roleLabel: "huésped",
        });
      }

      case "feedback_review_host": {
        return dispatch(hostEmail, {
          subjectKey: "tab_reservas_email_payout_released_subject",
          subjectFallback: "Fondos liberados",
          introKey: "tab_reservas_email_payout_released_intro",
          introFallback:
            "Los fondos de la reserva han sido liberados tras la valoración del huésped.",
          roleLabel: "anfitrión",
        });
      }

      case "feedback_report_guest": {
        return dispatch(guestEmail, {
          subjectKey: "nrf_feedback_email_report_ack_subject",
          subjectFallback: "Incidencia recibida",
          introKey: "nrf_feedback_email_report_ack_intro",
          introFallback: "Hemos recibido tu reporte. Lo revisaremos.",
          roleLabel: "huésped",
        });
      }

      case "feedback_report_host": {
        return dispatch(hostEmail, {
          subjectKey: "tab_reservas_email_dispute_host_subject",
          subjectFallback: "Fondos retenidos",
          introKey: "tab_reservas_email_dispute_host_intro",
          introFallback:
            "El huésped ha reportado una incidencia. Los fondos quedan retenidos.",
          roleLabel: "anfitrión",
        });
      }

      case "feedback_report_admin": {
        const reportReason = (payload.report_reason ?? "").trim();
        const comment = (payload.comment ?? "").trim();
        let extra = `<p><strong>${this.escapeHtml(reportReason)}</strong></p>`;
        if (comment !== "") {
          extra += `<p>${this.escapeHtml(comment)}</p><br>`;
        }
        return dispatch(adminEmail, {
          subjectKey: "tab_reservas_email_dispute_admin_subject",
          subjectFallback: "Nueva disputa de reserva",
          introKey: "tab_reservas_email_dispute_admin_intro",
          introFallback: "Se ha abierto una disputa.",
          roleLabel: "admin",
          extraHtml: extra,
        });
      }

      case "payout_released_host": {
        return dispatch(hostEmail, {
          subjectKey: "tab_reservas_email_payout_released_subject",
          subjectFallback: "Fondos liberados",
          introKey: "tab_reservas_email_payout_released_intro",
          introFallback: "Los fondos han sido transferidos a tu cuenta.",
          roleLabel: "anfitrión",
        });
      }

      case "payout_released_guest": {
        return dispatch(guestEmail, {
          subjectKey: "nrf_feedback_email_stay_thanks_subject",
          subjectFallback: "Gracias por tu estancia",
          introKey: "nrf_feedback_email_stay_thanks_intro",
          introFallback: "Gracias por confiar en viajes4patas.",
          roleLabel: "huésped",
        });
      }

      case "payout_failed_host": {
        const err = (payload.error_message ?? "").trim();
        const extra = err === "" ? "" : `<p>${this.escapeHtml(err)}</p><br>`;
        return dispatch(hostEmail, {
          subjectKey: "tab_reservas_email_payout_failed_subject",
          subjectFallback: "Error al liberar fondos",
          introKey: "tab_reservas_email_payout_failed_host_intro",
          introFallback: "No se pudo transferir el pago.",
          roleLabel: "anfitrión",
          extraHtml: extra,
        });
      }

      case "payout_failed_admin": {
        const err = (payload.error_message ?? "").trim();
        const extra = err === "" ? "" : `<p>${this.escapeHtml(err)}</p><br>`;
        return dispatch(adminEmail, {
          subjectKey: "tab_reservas_email_payout_failed_subject",
          subjectFallback: "Error transfer Stripe",
          introKey: "tab_reservas_email_payout_failed_admin_intro",
          introFallback: "Fallo al liberar fondos de reserva.",
          roleLabel: "admin",
          extraHtml: extra,
        });
      }

      case "refund_processed_guest": {
        return dispatch(guestEmail, {
          subjectKey: "tab_reservas_email_refund_subject",
          subjectFallback: "Reembolso procesado",
          introKey: "tab_reservas_email_refund_guest_intro",
          introFallback: "Tu reembolso ha sido procesado.",
          roleLabel: "huésped",
        });
      }

      case "refund_processed_host": {
        return dispatch(hostEmail, {
          subjectKey: "tab_reservas_email_refund_subject",
          subjectFallback: "Reembolso procesado",
          introKey: "tab_reservas_email_refund_host_intro",
          introFallback: "Se ha procesado un reembolso al huésped.",
          roleLabel: "anfitrión",
        });
      }

      default: {
        return null;
      }
    }
  }

  private buildBody(
    vble: VbleMap,
    block: ReservationBlock,
    config: DispatchConfig,
  ): string {
    let body = "";
    body += this.text(config.introKey, config.introFallback, vble) + "<br><br>";
    body += block.html;
    if (config.extraHtml) {
      body += config.extraHtml;
    }
    if (config.outroKey) {
      body += this.text(config.outroKey, config.outroFallback ?? "", vble);
    }
    body += "<br><br><h6>" + this.text("emailfootnote", "", vble) + "</h6>";
    return body;
  }

  private async loadReservationVble(customer: string): Promise<VbleMap> {
    const prefix = envs.DB_PREFIX;
    const rows = await this.mysqlService.query<JvariableRow>(
      `SELECT B.variable, B.description_l1 AS value
       FROM ${prefix}variables0 A
       JOIN ${prefix}variables1 B ON A.id = B.idback
       WHERE A.customer = ? AND A.pagina IN ('alojamiento', 'reserva_checkout')
       ORDER BY B.sequence`,
      [customer],
    );

    const vble: VbleMap = {};
    for (const row of rows) {
      if (row.variable) {
        vble[row.variable] = row.value ?? "";
      }
    }

    const lang = envs.BOOKING_EMAIL_LANG;
    if (lang === "es" || Object.keys(vble).length === 0) {
      return vble;
    }

    const fieldKeys = Object.keys(vble);
    const placeholders = fieldKeys.map(() => "?").join(", ");
    const tableName = `${prefix}variables1`;
    const translations = await this.mysqlService.query<TranslationRow>(
      `SELECT field, value FROM ${prefix}clientes_translations
       WHERE table_name = ? AND lang = ? AND field IN (${placeholders})`,
      [tableName, lang, ...fieldKeys],
    );

    for (const tr of translations) {
      if (tr.field && vble[tr.field] !== undefined) {
        vble[tr.field] = tr.value;
      }
    }

    return vble;
  }

  private formatReservationBlock(
    payload: ReservationEmailPayload,
    vble: VbleMap,
  ): ReservationBlock {
    const reservationId = payload.reservation_id ?? 0;
    const guestName = (payload.guest_name ?? "").trim();
    const guestEmail = (payload.guest_email ?? "").trim();
    const guestPhone = (payload.guest_phone ?? "").trim();
    const checkin = (payload.checkin ?? "").trim();
    const checkout = (payload.checkout ?? "").trim();
    const guests = payload.guests ?? 0;
    const pets = payload.pets ?? 0;
    const total = payload.total ?? 0;
    const siteName = (payload.site_name ?? "").trim();

    const resCode = `#RES-${reservationId}`;
    const checkinFmt = this.formatDate(checkin);
    const checkoutFmt = this.formatDate(checkout);
    const totalFmt = `${total.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

    let html = "";
    html +=
      this.text("nrf_email_code_label", "Código", vble) +
      `: <strong>${this.escapeHtml(resCode)}</strong><br><br>`;
    html +=
      this.text("nrf_email_site_label", "Alojamiento", vble) +
      `: <strong>${this.escapeHtml(siteName || "Alojamiento")}</strong><br><br>`;

    if (guestName !== "") {
      html +=
        this.text("fsi_name_caption", "Nombre", vble) +
        `: <strong>${this.escapeHtml(guestName)}</strong><br><br>`;
    }
    if (guestPhone !== "") {
      html +=
        this.text("fsi_phone_caption", "Teléfono", vble) +
        `: <strong>${this.escapeHtml(guestPhone)}</strong><br><br>`;
    }
    if (guestEmail !== "") {
      html +=
        this.text("fsi_email_caption", "Email", vble) +
        `: <strong>${this.escapeHtml(guestEmail)}</strong><br><br>`;
    }
    html +=
      this.text("fsi_datefrom_caption", "Entrada", vble) +
      `: <strong>${this.escapeHtml(checkinFmt)}</strong>&nbsp;&nbsp;`;
    html +=
      this.text("fsi_dateto_caption", "Salida", vble) +
      `: <strong>${this.escapeHtml(checkoutFmt)}</strong><br><br>`;
    html +=
      this.text("fsi_numberadults_caption", "Huéspedes", vble) +
      `: <strong>${guests}</strong>&nbsp;&nbsp;`;
    html +=
      this.text("fsi_numberpets_caption", "Mascotas", vble) +
      `: <strong>${pets}</strong><br><br>`;
    html +=
      this.text("nrf_total_label", "Total", vble) +
      `: <strong>${this.escapeHtml(totalFmt)}</strong><br><br>`;

    return { resCode, totalFmt, html };
  }

  private text(key: string, fallback: string, vble: VbleMap): string {
    console.log("key", key);
    console.log("vble", vble);
    console.log("fallback", fallback);
    const fromVble = (vble[key] ?? "").trim();
    console.log("fromVble", fromVble);
    if (fromVble) {
      return fromVble;
    }
    return fallback;
  }

  private formatDate(isoDate: string): string {
    if (!isoDate) {
      return "";
    }
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
    if (dateOnly) {
      return `${dateOnly[3]}-${dateOnly[2]}-${dateOnly[1]}`;
    }
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
      return isoDate;
    }
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
}
