import { Injectable, Logger } from "@nestjs/common";

import { envs } from "../../shared/configs/envs";
import { ReservationEntity } from "../entities/reservation.entity";

@Injectable()
export class ReservationEmailService {
  private readonly logger = new Logger(ReservationEmailService.name);

  async sendConfirmationEmail(
    reservation: ReservationEntity,
    siteName: string,
    hostEmail: string,
  ): Promise<void> {
    if (!envs.BOOKING_EMAIL_TOKEN) {
      this.logger.warn(
        "BOOKING_EMAIL_TOKEN not set; skipping confirmation email",
      );
      return;
    }

    const webBase = (envs.BOOKING_WEB_URL ?? envs.FRONTEND_URL).replace(
      /\/+$/,
      "",
    );
    const url = `${webBase}/php/booking_reservation_confirm_email.php`;
    const payload = {
      reservation_id: reservation.id,
      guest_name: reservation.guest_name ?? "",
      guest_email: reservation.guest_email ?? "",
      guest_phone: reservation.guest_phone ?? "",
      checkin: reservation.checkin,
      checkout: reservation.checkout,
      guests: reservation.guests,
      pets: reservation.pets,
      total: Number(reservation.total ?? 0),
      site_id: reservation.site_id,
      site_name: siteName,
      host_email: hostEmail,
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${envs.BOOKING_EMAIL_TOKEN}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        this.logger.warn(
          `Confirmation email HTTP ${response.status}: ${text.slice(0, 200)}`,
        );
      }
    } catch (error) {
      this.logger.error(
        "Failed to call confirmation email endpoint",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
