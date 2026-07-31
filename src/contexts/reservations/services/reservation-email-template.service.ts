import type {
  BuiltReservationEmail,
  ReservationEmailPayload,
  ReservationEmailType,
} from "../types/reservation-email.types";

import { Injectable, Logger } from "@nestjs/common";

import { envs } from "../../shared/configs/envs";

interface ReservationBlock {
  resCode: string;
  totalFmt: string;
  html: string;
}

interface DispatchConfig {
  subject: string;
  intro: string;
  outro?: string;
  roleLabel: string;
  extraHtml?: string;
}

@Injectable()
export class ReservationEmailTemplateService {
  private readonly logger = new Logger(ReservationEmailTemplateService.name);

  build(
    emailType: ReservationEmailType,
    payload: ReservationEmailPayload,
  ): BuiltReservationEmail | null {
    const block = this.formatReservationBlock(payload);
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
      return {
        to,
        subject: `${config.subject} ${block.resCode}`,
        html: this.buildBody(block, config),
        roleLabel: config.roleLabel,
      };
    };

    switch (emailType) {
      case "payment_confirmed_guest": {
        return dispatch(guestEmail, {
          subject: "Confirmación de reserva",
          intro: "Tu reserva ha sido confirmada.",
          roleLabel: "huésped",
        });
      }

      case "payment_confirmed_host": {
        return dispatch(hostEmail, {
          subject: "Nueva reserva",
          intro: "Has recibido una nueva reserva.",
          outro: "Revisa la reserva en tu panel.",
          roleLabel: "anfitrión",
        });
      }

      case "cancelled_guest_refund": {
        return dispatch(guestEmail, {
          subject: "Reserva cancelada",
          intro: "Tu reserva ha sido cancelada.",
          roleLabel: "huésped",
          extraHtml: `<p>${this.escapeHtml("Se ha procesado el reembolso.")}</p><br>`,
        });
      }

      case "cancelled_guest_no_refund": {
        return dispatch(guestEmail, {
          subject: "Reserva cancelada",
          intro: "Tu reserva ha sido cancelada sin reembolso.",
          roleLabel: "huésped",
        });
      }

      case "cancelled_host": {
        return dispatch(hostEmail, {
          subject: "Reserva cancelada",
          intro: "Una reserva ha sido cancelada.",
          roleLabel: "anfitrión",
        });
      }

      case "finalized_guest_feedback": {
        const feedbackUrl = (payload.feedback_url ?? "").trim();
        let linkHtml = "";
        if (feedbackUrl !== "") {
          linkHtml = `<p><a href="${this.escapeHtml(feedbackUrl)}">${this.escapeHtml("Valorar tu estancia")}</a></p><br>`;
        }
        return dispatch(guestEmail, {
          subject: "Cuéntanos tu experiencia",
          intro: "Tu estancia ha finalizado. Valora o reporta incidencias.",
          roleLabel: "huésped",
          extraHtml: linkHtml,
        });
      }

      case "finalized_host": {
        return dispatch(hostEmail, {
          subject: "Estancia finalizada",
          intro:
            "Has finalizado la estancia. El huésped tiene 24h para valorar.",
          roleLabel: "anfitrión",
        });
      }

      case "feedback_review_guest": {
        return dispatch(guestEmail, {
          subject: "Gracias por tu valoración",
          intro: "Hemos recibido tu valoración. ¡Gracias!",
          roleLabel: "huésped",
        });
      }

      case "feedback_review_host": {
        return dispatch(hostEmail, {
          subject: "Fondos liberados",
          intro:
            "Los fondos de la reserva han sido liberados tras la valoración del huésped.",
          roleLabel: "anfitrión",
        });
      }

      case "feedback_report_guest": {
        return dispatch(guestEmail, {
          subject: "Incidencia recibida",
          intro: "Hemos recibido tu reporte. Lo revisaremos.",
          roleLabel: "huésped",
        });
      }

      case "feedback_report_host": {
        return dispatch(hostEmail, {
          subject: "Fondos retenidos",
          intro:
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
          subject: "Nueva disputa de reserva",
          intro: "Se ha abierto una disputa.",
          roleLabel: "admin",
          extraHtml: extra,
        });
      }

      case "payout_released_host": {
        return dispatch(hostEmail, {
          subject: "Fondos liberados",
          intro: "Los fondos han sido transferidos a tu cuenta.",
          roleLabel: "anfitrión",
        });
      }

      case "payout_released_guest": {
        return dispatch(guestEmail, {
          subject: "Gracias por tu estancia",
          intro: "Gracias por confiar en viajes4patas.",
          roleLabel: "huésped",
        });
      }

      case "payout_failed_host": {
        const err = (payload.error_message ?? "").trim();
        const extra = err === "" ? "" : `<p>${this.escapeHtml(err)}</p><br>`;
        return dispatch(hostEmail, {
          subject: "Error al liberar fondos",
          intro: "No se pudo transferir el pago.",
          roleLabel: "anfitrión",
          extraHtml: extra,
        });
      }

      case "payout_failed_admin": {
        const err = (payload.error_message ?? "").trim();
        const extra = err === "" ? "" : `<p>${this.escapeHtml(err)}</p><br>`;
        return dispatch(adminEmail, {
          subject: "Error transfer Stripe",
          intro: "Fallo al liberar fondos de reserva.",
          roleLabel: "admin",
          extraHtml: extra,
        });
      }

      case "refund_processed_guest": {
        return dispatch(guestEmail, {
          subject: "Reembolso procesado",
          intro: "Tu reembolso ha sido procesado.",
          roleLabel: "huésped",
        });
      }

      case "refund_processed_host": {
        return dispatch(hostEmail, {
          subject: "Reembolso procesado",
          intro: "Se ha procesado un reembolso al huésped.",
          roleLabel: "anfitrión",
        });
      }

      default: {
        return null;
      }
    }
  }

  private buildBody(block: ReservationBlock, config: DispatchConfig): string {
    let body = "";
    body += config.intro + "<br><br>";
    body += block.html;
    if (config.extraHtml) {
      body += config.extraHtml;
    }
    if (config.outro) {
      body += config.outro;
    }
    return body;
  }

  private formatReservationBlock(
    payload: ReservationEmailPayload,
  ): ReservationBlock {
    const reservationId = payload.reservation_id;
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
    html += `Código: <strong>${this.escapeHtml(resCode)}</strong><br><br>`;
    html += `Alojamiento: <strong>${this.escapeHtml(siteName || "Alojamiento")}</strong><br><br>`;

    if (guestName !== "") {
      html += `Nombre: <strong>${this.escapeHtml(guestName)}</strong><br><br>`;
    }
    if (guestPhone !== "") {
      html += `Teléfono: <strong>${this.escapeHtml(guestPhone)}</strong><br><br>`;
    }
    if (guestEmail !== "") {
      html += `Email: <strong>${this.escapeHtml(guestEmail)}</strong><br><br>`;
    }
    html += `Entrada: <strong>${this.escapeHtml(checkinFmt)}</strong>&nbsp;&nbsp;`;
    html += `Salida: <strong>${this.escapeHtml(checkoutFmt)}</strong><br><br>`;
    html += `Huéspedes: <strong>${guests}</strong>&nbsp;&nbsp;`;
    html += `Mascotas: <strong>${pets}</strong><br><br>`;
    html += `Total: <strong>${this.escapeHtml(totalFmt)}</strong><br><br>`;

    return { resCode, totalFmt, html };
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
