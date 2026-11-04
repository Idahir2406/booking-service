import type {
  BuiltReservationEmail,
  HostNoticeEmailPayload,
  HostNoticeEmailType,
  IncidentMessageEmailPayload,
  IncidentMessageEmailType,
  IncidentMessageEvent,
  ReservationEmailPayload,
  ReservationEmailType,
} from "../types/reservation-email.types";

import { Injectable, Logger } from "@nestjs/common";

import { envs } from "../../shared/configs/envs";
import {
  INCIDENT_MESSAGE_EMAIL,
  INCIDENT_MESSAGE_EVENT,
} from "../types/reservation-email.types";
import {
  INCIDENT_AUTHOR,
  incidentRef,
} from "../utils/reservation-incident.util";

/** Spanish labels for the incident emails (same texts as cv_inc_type_*). */
const INCIDENT_TYPE_LABEL: Record<string, string> = {
  before_arrival: "Antes de llegar",
  during_stay: "Durante la estancia",
  dog_issue: "Problema con mi perro",
  conditions_not_respected: "No se han respetado las condiciones",
  charge_issue: "Problema con un cobro",
  refund_issue: "Problema con un reembolso",
  force_majeure_cancellation: "Cancelación por circunstancia excepcional",
  no_show: "No presentación indicada por el alojamiento",
  other: "Otro",
};

/** Same texts as cv_inc_status_*. */
const INCIDENT_STATUS_LABEL: Record<string, string> = {
  received: "Recibida",
  in_review: "En revisión",
  needs_info: "Necesitamos información",
  resolved: "Resuelta",
};

const STRIPE_CHECK_HINT =
  "Revisa tu cuenta de cobros desde Mi perfil > Reservas > «Ver mis cobros en Stripe».";

const TRAVELER_REPLY_HINT =
  "Para responder, escribe en la conversación de la incidencia desde tu panel (no respondas a este email).";

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
          extraHtml: this.confirmationBreakdownHtml(payload),
        });
      }

      case "payment_confirmed_host": {
        return dispatch(hostEmail, {
          subject: "Nueva reserva",
          intro: "Has recibido una nueva reserva.",
          outro: "Revisa la reserva en tu panel.",
          roleLabel: "anfitrión",
          extraHtml: this.confirmationBreakdownHtml(payload),
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
          outro: `<p>${this.escapeHtml(STRIPE_CHECK_HINT)}</p>`,
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

      case "payment_after_expiry_refund_guest": {
        return dispatch(guestEmail, {
          subject: "Pago reembolsado",
          intro:
            "Hemos recibido tu pago cuando la reserva ya había expirado y las fechas ya no están disponibles.",
          outro:
            "Te hemos devuelto el importe íntegro. El reembolso puede tardar unos días en aparecer en tu cuenta.",
          roleLabel: "huésped",
        });
      }

      case "payment_after_expiry_refund_admin": {
        return dispatch(adminEmail, {
          subject: "Reembolso automático (pago tras expiración)",
          intro:
            "Se recibió un pago de una reserva expirada/cancelada sin disponibilidad; se ha reembolsado automáticamente.",
          roleLabel: "admin",
        });
      }

      case "refund_processed_host": {
        return dispatch(hostEmail, {
          subject: "Reembolso procesado",
          intro: "Se ha procesado un reembolso al huésped.",
          roleLabel: "anfitrión",
        });
      }

      case "refund_failed_guest": {
        const err = (payload.error_message ?? "").trim();
        return dispatch(guestEmail, {
          subject: "Reembolso no completado",
          intro:
            "No hemos podido completar tu reembolso. Nuestro equipo lo revisará.",
          outro: err === "" ? "" : err,
          roleLabel: "huésped",
        });
      }

      case "refund_failed_host": {
        return dispatch(hostEmail, {
          subject: "Reembolso no completado",
          intro: "Un reembolso al huésped no se ha completado en Stripe.",
          roleLabel: "anfitrión",
        });
      }

      case "refund_failed_admin": {
        const err = (payload.error_message ?? "").trim();
        return dispatch(adminEmail, {
          subject: "Reembolso fallido",
          intro: "Stripe ha devuelto un reembolso como fallido.",
          roleLabel: "admin",
          extraHtml: err === "" ? "" : `<p>${this.escapeHtml(err)}</p><br>`,
        });
      }

      case "force_majeure_review_admin": {
        return dispatch(adminEmail, {
          subject: "Cancelación por fuerza mayor",
          intro:
            "Un viajero ha cancelado por fuerza mayor; revisa el reembolso pendiente.",
          roleLabel: "admin",
        });
      }

      case "incident_opened_admin": {
        const incidentType = (payload.report_reason ?? "").trim();
        const description = (payload.comment ?? "").trim();
        let extra = `<p><strong>${this.escapeHtml(incidentType)}</strong></p>`;
        if (description !== "") {
          extra += `<p>${this.escapeHtml(description)}</p><br>`;
        }
        return dispatch(adminEmail, {
          subject: payload.refund
            ? "Incidencia del viajero (payout bloqueado)"
            : "Incidencia del viajero",
          intro: "Un viajero ha abierto una incidencia desde su panel.",
          roleLabel: "admin",
          extraHtml: extra,
        });
      }

      case "exceptional_refund_review_admin": {
        const amount = payload.total_cents ?? 0;
        return dispatch(adminEmail, {
          subject: "Reembolso excepcional solicitado",
          intro: `Un anfitrión ha solicitado un reembolso excepcional de ${this.money(amount)}.`,
          roleLabel: "admin",
        });
      }

      case "no_show_reported_guest": {
        return dispatch(guestEmail, {
          subject: "El alojamiento indica que no te presentaste",
          intro:
            "El alojamiento ha indicado que no llegaste a tu estancia. Hemos abierto una incidencia y el equipo de viajes4patas la revisará antes de aplicar la política de no presentación de tu reserva.",
          outro: `<p>${this.escapeHtml("Si sí llegaste o hubo algún problema, cuéntanoslo desde la pestaña Incidencias de tu panel.")}</p>`,
          roleLabel: "huésped",
          extraHtml: this.noteHtml(payload.note),
        });
      }

      case "no_show_reported_admin": {
        return dispatch(adminEmail, {
          subject: "No-show indicado por el alojamiento (payout bloqueado)",
          intro:
            "El alojamiento ha marcado esta reserva como no presentada. Revísalo en la incidencia del backoffice para confirmar o rechazar el no-show.",
          roleLabel: "admin",
          extraHtml: this.noteHtml(payload.note),
        });
      }

      case "no_show_confirmed_guest": {
        const refund = payload.refund_cents ?? 0;
        return dispatch(guestEmail, {
          subject: "No presentación confirmada",
          intro:
            refund > 0
              ? `Hemos confirmado la no presentación y aplicado la política de tu reserva. Te devolvemos ${this.money(refund)}; puede tardar unos días en aparecer en tu cuenta.`
              : "Hemos confirmado la no presentación y aplicado la política de tu reserva, que no contempla devolución.",
          roleLabel: "huésped",
          extraHtml: this.noteHtml(payload.note),
        });
      }

      case "no_show_confirmed_host": {
        const refund = payload.refund_cents ?? 0;
        return dispatch(hostEmail, {
          subject: "No presentación confirmada",
          intro:
            refund > 0
              ? `Hemos confirmado la no presentación. Según la política de la reserva se devuelven ${this.money(refund)} al viajero y el resto se te liquidará en breve.`
              : "Hemos confirmado la no presentación. Según la política de la reserva no hay devolución y el importe se te liquidará en breve.",
          roleLabel: "anfitrión",
          extraHtml: this.noteHtml(payload.note),
        });
      }

      case "no_show_rejected_guest": {
        return dispatch(guestEmail, {
          subject: "Incidencia de no presentación cerrada",
          intro:
            "Hemos revisado la incidencia y no se aplica la no presentación. Tu reserva sigue como estaba.",
          roleLabel: "huésped",
          extraHtml: this.noteHtml(payload.note),
        });
      }

      case "no_show_rejected_host": {
        return dispatch(hostEmail, {
          subject: "No presentación no confirmada",
          intro:
            "Hemos revisado la no presentación indicada y no se confirma. La reserva sigue su curso normal: finalízala cuando termine la estancia.",
          roleLabel: "anfitrión",
          extraHtml: this.noteHtml(payload.note),
        });
      }

      default: {
        return null;
      }
    }
  }

  /**
   * Punto 9: host-level notice (bank payout failed / new reservations
   * paused). Not tied to one reservation, so no reservation block.
   */
  buildHostNotice(
    emailType: HostNoticeEmailType,
    payload: HostNoticeEmailPayload,
  ): BuiltReservationEmail | null {
    const forAdmin =
      emailType === "payout_bank_failed_admin" ||
      emailType === "payout_blocked_admin";
    const to = (
      forAdmin
        ? (payload.admin_email ?? envs.BOOKING_ADMIN_EMAIL)
        : payload.host_email
    ).trim();
    const roleLabel = forAdmin ? "admin" : "anfitrión";
    if (to === "") {
      this.logger.warn(
        `Email ${emailType} skipped for host user ${payload.host_user_id}: missing recipient (${roleLabel})`,
      );
      return null;
    }

    const bank = emailType.startsWith("payout_bank_failed");
    const days = payload.days ?? 7;
    let subject: string;
    let intro: string;
    if (bank) {
      subject = forAdmin
        ? "Stripe no pudo pagar al banco de un alojamiento"
        : "Stripe no ha podido enviar tu dinero a tu banco";
      intro = forAdmin
        ? "Stripe ha devuelto como fallido un pago a la cuenta bancaria de este alojamiento. El dinero sigue en su saldo de Stripe."
        : `Stripe no ha podido enviar tu saldo a tu cuenta bancaria. El dinero sigue en tu saldo de Stripe. Revisa tus datos bancarios; si no se resuelve en ${days} días, pausaremos las nuevas reservas de tu alojamiento.`;
    } else {
      subject = forAdmin
        ? "Reservas pausadas por pagos fallidos"
        : "Tus nuevas reservas están pausadas";
      const cause =
        payload.reason === "bank_payout_failed"
          ? "Stripe no puede pagar a tu cuenta bancaria"
          : "no podemos transferirte el pago de tus reservas";
      intro = forAdmin
        ? `Han pasado ${days} días con pagos fallidos sin resolver. Las nuevas reservas de este alojamiento están pausadas hasta que se resuelva.`
        : `Desde hace ${days} días ${cause}. Hemos pausado las nuevas reservas de tu alojamiento hasta que se resuelva; las reservas ya confirmadas no cambian.`;
    }

    const rows: [string, string][] = [];
    if (payload.site_names.length > 0) {
      rows.push(["Alojamiento", payload.site_names.join(", ")]);
    }
    if (forAdmin) {
      rows.push(["Usuario anfitrión", `#${payload.host_user_id}`]);
      if (payload.host_email !== "") {
        rows.push(["Email anfitrión", payload.host_email]);
      }
    }
    if (payload.amount_cents) {
      rows.push(["Importe", this.money(payload.amount_cents)]);
    }
    if (payload.failure_message) {
      rows.push(["Motivo", payload.failure_message]);
    }
    if (payload.reservation_ids && payload.reservation_ids.length > 0) {
      rows.push([
        "Reservas afectadas",
        payload.reservation_ids.map(id => `#RES-${id}`).join(", "),
      ]);
    }

    let html = `<p>${this.escapeHtml(intro)}</p>`;
    html += rows
      .map(
        ([label, value]) =>
          `${this.escapeHtml(label)}: <strong>${this.escapeHtml(value)}</strong><br>`,
      )
      .join("");
    let text = `${intro}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}\n`;
    if (!forAdmin) {
      html += `<br><p>${this.escapeHtml(STRIPE_CHECK_HINT)}</p>`;
      text += `\n${STRIPE_CHECK_HINT}\n`;
    }
    return { to, subject, html, text, roleLabel };
  }

  private noteHtml(note: string | undefined): string {
    const value = (note ?? "").trim();
    if (value === "") {
      return "";
    }
    return `<div style="white-space:pre-wrap;border-left:3px solid #395b50;padding:8px 12px;background:#f5f5f5">${this.escapeHtml(value)}</div><br>`;
  }

  /**
   * Incident chat (2026-10-25): one email per message and recipient. The
   * admin template always links to the admino detail; the traveler one to
   * the "Incidencias" tab of the account. Every user value is escaped in the
   * HTML and repeated in the plain-text alternative.
   */
  buildIncidentMessage(
    emailType: IncidentMessageEmailType,
    payload: IncidentMessageEmailPayload,
  ): BuiltReservationEmail | null {
    const incCode = incidentRef(payload.incident_id);
    const resCode = `#RES-${payload.reservation_id}`;
    const refs = `${incCode} (${resCode})`;
    const fromTraveler = payload.author === INCIDENT_AUTHOR.TRAVELER;
    const forAdmin = emailType === INCIDENT_MESSAGE_EMAIL.ADMIN;
    const to = (forAdmin ? payload.admin_email : payload.traveler_email).trim();
    const roleLabel = forAdmin ? "admin" : "huésped";
    if (to === "") {
      this.logger.warn(
        `Email ${emailType} skipped for incident ${incCode}: missing recipient (${roleLabel})`,
      );
      return null;
    }

    const { subject, intro, bodyTitle } = this.incidentCopy(
      forAdmin,
      fromTraveler,
      payload.event,
      refs,
    );
    const link = forAdmin ? payload.admin_url : payload.panel_url;
    const linkLabel = forAdmin
      ? "Abrir la incidencia en el backoffice"
      : "Ver la conversación en tu panel";
    const siteLabel = [payload.site_name, payload.site_town]
      .filter((part): part is string => !!part && part.trim() !== "")
      .join(" · ");
    const stay =
      payload.checkin && payload.checkout
        ? `${this.formatDate(payload.checkin)} - ${this.formatDate(payload.checkout)}`
        : "";
    const rows: [string, string][] = [
      ["Incidencia", incCode],
      ["Reserva", resCode],
      [
        "Tipo",
        INCIDENT_TYPE_LABEL[payload.incident_type] ?? payload.incident_type,
      ],
      [
        "Estado",
        INCIDENT_STATUS_LABEL[payload.incident_status] ??
          payload.incident_status,
      ],
    ];
    if (siteLabel !== "") {
      rows.push(["Alojamiento", siteLabel]);
    }
    if (stay !== "") {
      rows.push(["Estancia", stay]);
    }
    if (forAdmin) {
      const traveler = [payload.traveler_name, payload.traveler_email]
        .filter((part): part is string => !!part && part.trim() !== "")
        .join(" · ");
      if (traveler !== "") {
        rows.push(["Viajero", traveler]);
      }
      if (!fromTraveler && payload.actor_name) {
        rows.push(["Enviado por", payload.actor_name]);
      }
    }

    let html = `<p>${this.escapeHtml(intro)}</p>`;
    html += rows
      .map(
        ([label, value]) =>
          `${this.escapeHtml(label)}: <strong>${this.escapeHtml(value)}</strong><br>`,
      )
      .join("");
    html += `<br><p><strong>${this.escapeHtml(bodyTitle)}</strong></p>`;
    html += `<div style="white-space:pre-wrap;border-left:3px solid #395b50;padding:8px 12px;background:#f5f5f5">${this.escapeHtml(payload.body)}</div><br>`;
    if (link !== "") {
      html += `<p><a href="${this.escapeHtml(link)}">${this.escapeHtml(linkLabel)}</a></p>`;
    }
    if (!forAdmin) {
      html += `<p>${this.escapeHtml(TRAVELER_REPLY_HINT)}</p>`;
    }

    let text = `${intro}\n\n`;
    text += rows.map(([label, value]) => `${label}: ${value}`).join("\n");
    text += `\n\n${bodyTitle}\n${payload.body}\n\n`;
    if (link !== "") {
      text += `${linkLabel}: ${link}\n`;
    }
    if (!forAdmin) {
      text += `\n${TRAVELER_REPLY_HINT}\n`;
    }
    return { to, subject, html, text, roleLabel };
  }

  private incidentCopy(
    forAdmin: boolean,
    fromTraveler: boolean,
    event: IncidentMessageEvent,
    refs: string,
  ): { subject: string; intro: string; bodyTitle: string } {
    if (forAdmin) {
      if (fromTraveler) {
        return {
          subject: `Nuevo mensaje del viajero en la incidencia ${refs}`,
          intro: "El viajero ha escrito en la conversación de su incidencia.",
          bodyTitle: "Mensaje del viajero",
        };
      }
      if (event === INCIDENT_MESSAGE_EVENT.RESOLVED) {
        return {
          subject: `Copia: incidencia resuelta ${refs}`,
          intro:
            "Se ha resuelto la incidencia y el viajero ha recibido esta nota por email.",
          bodyTitle: "Nota de resolución enviada",
        };
      }
      return {
        subject: `Copia: respuesta enviada en la incidencia ${refs}`,
        intro:
          "Se ha enviado este mensaje al viajero (copia para el equipo V4P).",
        bodyTitle: "Mensaje enviado al viajero",
      };
    }
    if (fromTraveler) {
      if (event === INCIDENT_MESSAGE_EVENT.OPENED) {
        return {
          subject: `Hemos recibido tu incidencia ${refs}`,
          intro:
            "Hemos recibido tu incidencia. La revisaremos y te responderemos en la conversación de tu panel.",
          bodyTitle: "Lo que nos has contado",
        };
      }
      return {
        subject: `Hemos recibido tu mensaje en la incidencia ${refs}`,
        intro: "Esta es una copia del mensaje que nos has enviado.",
        bodyTitle: "Tu mensaje",
      };
    }
    if (event === INCIDENT_MESSAGE_EVENT.RESOLVED) {
      return {
        subject: `Tu incidencia se ha resuelto ${refs}`,
        intro: "Hemos resuelto tu incidencia. Esta es la nota del equipo.",
        bodyTitle: "Resolución",
      };
    }
    return {
      subject: `Nuevo mensaje en tu incidencia ${refs}`,
      intro: "El equipo de viajes4patas te ha escrito sobre tu incidencia.",
      bodyTitle: "Mensaje del equipo",
    };
  }

  private money(cents: number): string {
    return `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  }

  /**
   * F2: dogs, price breakdown by lines and deposit info (B6/B7, A26).
   * Empty for legacy reservations without a snapshot.
   */
  confirmationBreakdownHtml(payload: ReservationEmailPayload): string {
    let html = "";
    const dogs = payload.dogs ?? [];
    if (dogs.length > 0) {
      html += `<p><strong>${this.escapeHtml("Perros declarados")}</strong></p><ul>`;
      for (const dog of dogs) {
        const parts = [
          dog.name ?? "Perro",
          `${dog.weight_kg} kg`,
          dog.size ?? "",
          dog.is_ppp ? "PPP" : "",
        ].filter(part => part !== "");
        html += `<li>${this.escapeHtml(parts.join(" · "))}</li>`;
      }
      html += "</ul>";
    }
    const lines = payload.price_lines ?? [];
    if (lines.length > 0) {
      html += `<p><strong>${this.escapeHtml("Desglose del precio")}</strong></p>`;
      html +=
        '<table cellpadding="4" cellspacing="0" style="border-collapse:collapse">';
      for (const line of lines) {
        const label = line.detail
          ? `${line.description} (${line.detail})`
          : line.description;
        const optional = line.is_optional ? " · opcional" : "";
        html += `<tr><td>${this.escapeHtml(label + optional)}</td><td style="text-align:right"><strong>${this.escapeHtml(this.money(line.amount_cents))}</strong></td></tr>`;
      }
      if (payload.total_cents !== undefined) {
        html += `<tr><td><strong>Total pagado</strong></td><td style="text-align:right"><strong>${this.escapeHtml(this.money(payload.total_cents))}</strong></td></tr>`;
      }
      html += "</table><br>";
    }
    const deposit = payload.deposit ?? null;
    if (deposit?.required && deposit.message) {
      html += `<p><strong>${this.escapeHtml("Fianza")}</strong><br>${this.escapeHtml(deposit.message)}</p><br>`;
    }
    return html;
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
