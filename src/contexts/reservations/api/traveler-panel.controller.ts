import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { InternalApiKeyGuard } from "../../shared/guards/internal-api-key.guard";
import { CreateChangeRequestDto } from "../dto/reservation-change.dto";
import {
  AddIncidentAttachmentDto,
  AddIncidentMessageDto,
  CreateIncidentDto,
} from "../dto/reservation-incident.dto";
import { TravelerCancelPreviewDto } from "../dto/traveler-cancel-preview.dto";
import { TravelerReservationListQueryDto } from "../dto/traveler-reservation-list-query.dto";
import { ReservationAlternativeService } from "../services/reservation-alternative.service";
import { ReservationChangeService } from "../services/reservation-change.service";
import { ReservationFeedbackService } from "../services/reservation-feedback.service";
import { ReservationIncidentService } from "../services/reservation-incident.service";
import { ReservationRefundService } from "../services/reservation-refund.service";
import { TravelerIncidentInboxService } from "../services/traveler-incident-inbox.service";
import { TravelerReservationPanelService } from "../services/traveler-reservation-panel.service";
import { TravelerReservationPayService } from "../services/traveler-reservation-pay.service";

/**
 * Traveler panel (F-PV1). Own `traveler` prefix so these routes never
 * collide with the public `GET reservations/:id`. Internal only: the PHP
 * proxy puts `user_id` from $_SESSION, never from the browser.
 */
@Controller({
  path: "traveler",
  version: "1",
})
@UseGuards(InternalApiKeyGuard)
export class TravelerPanelController {
  constructor(
    private readonly panelService: TravelerReservationPanelService,
    private readonly feedbackService: ReservationFeedbackService,
    private readonly refundService: ReservationRefundService,
    private readonly incidentService: ReservationIncidentService,
    private readonly payService: TravelerReservationPayService,
    private readonly changeService: ReservationChangeService,
    private readonly alternativeService: ReservationAlternativeService,
    private readonly incidentInboxService: TravelerIncidentInboxService,
  ) {}

  /**
   * F-PV6 home: next trip + saved dogs + alerts in one round-trip.
   * Read-only, no side effects.
   */
  @Get(":user_id/dashboard")
  getDashboard(@Param("user_id", ParseIntPipe) userId: number) {
    return this.panelService.getDashboard(userId);
  }

  @Get(":user_id/reservations")
  listReservations(
    @Param("user_id", ParseIntPipe) userId: number,
    @Query() query: TravelerReservationListQueryDto,
  ) {
    return this.panelService.listForTraveler(
      userId,
      query.tab,
      query.limit,
      query.offset,
    );
  }

  @Get(":user_id/reservations/:id")
  getReservationDetail(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.panelService.getDetailForTraveler(userId, id);
  }

  @Post(":user_id/reservations/:id/feedback-token")
  issueFeedbackToken(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.feedbackService.issueTravelerFeedbackToken(userId, id);
  }

  /**
   * F-PV4: cancellation preview without side effects (POST because it takes
   * the reason in the body; 200, nothing is created).
   */
  @Post(":user_id/reservations/:id/cancel-preview")
  @HttpCode(HttpStatus.OK)
  previewCancellation(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: TravelerCancelPreviewDto,
  ) {
    return this.refundService.previewTravelerCancellation(
      userId,
      id,
      dto.cancellation_reason,
    );
  }

  /**
   * "Pagar reserva" (pay-pending): Stripe Checkout URL for an unfinished
   * pending checkout of THIS reservation (open session reused, otherwise a
   * new one with the same frozen amounts). 409/410 with a stable `code`.
   */
  @Post(":user_id/reservations/:id/pay")
  @HttpCode(HttpStatus.OK)
  payReservation(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.payService.payForTraveler(userId, id);
  }

  // ---------------------------------------------- F-PV7a incidents

  @Get(":user_id/reservations/:id/incidents")
  listIncidents(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.incidentService.listForTraveler(userId, id);
  }

  /** "Tengo un problema". D7 types block the payout of THIS reservation. */
  @Post(":user_id/reservations/:id/incidents")
  createIncident(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: CreateIncidentDto,
  ) {
    return this.incidentService.createForTraveler(userId, id, dto);
  }

  /**
   * "Incidencias" tab: every incident of the user's reservations (ownership
   * by reservations.user_id), last activity first, with site name/town for
   * the per-site grouping. Read-only.
   */
  @Get(":user_id/incidents")
  listAllIncidents(@Param("user_id", ParseIntPipe) userId: number) {
    return this.incidentInboxService.listForTraveler(userId);
  }

  /** Full chat of one incident (messages, attachments, can_reply). */
  @Get(":user_id/incidents/:incident_id")
  getIncidentThread(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("incident_id", ParseIntPipe) incidentId: number,
  ) {
    return this.incidentInboxService.getThreadForTraveler(userId, incidentId);
  }

  /** Metadata of a file the PHP proxy already stored privately (D5). */
  @Post(":user_id/incidents/:incident_id/attachments")
  addIncidentAttachment(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("incident_id", ParseIntPipe) incidentId: number,
    @Body() dto: AddIncidentAttachmentDto,
  ) {
    return this.incidentService.addAttachment(userId, incidentId, dto);
  }

  /** Chat message in any open status (resolved → 409 incident_closed). */
  @Post(":user_id/incidents/:incident_id/messages")
  addIncidentMessage(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("incident_id", ParseIntPipe) incidentId: number,
    @Body() dto: AddIncidentMessageDto,
  ) {
    return this.incidentService.addTravelerMessage(userId, incidentId, dto);
  }

  /** Ownership check + storage key so the PHP proxy can serve the file. */
  @Get(":user_id/incidents/:incident_id/attachments/:attachment_id")
  getIncidentAttachment(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("incident_id", ParseIntPipe) incidentId: number,
    @Param("attachment_id", ParseIntPipe) attachmentId: number,
  ) {
    return this.incidentService.getAttachmentFile(
      userId,
      incidentId,
      attachmentId,
    );
  }

  // ------------------------------- F-PV7b change requests / alternatives

  /** Requests (with proposals) + alternatives + can_request_change. */
  @Get(":user_id/reservations/:id/change-requests")
  listChangeRequests(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.changeService.listForTraveler(userId, id);
  }

  /** "¿Necesitas cambiar tu reserva?": never modifies the reservation. */
  @Post(":user_id/reservations/:id/change-requests")
  createChangeRequest(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: CreateChangeRequestDto,
  ) {
    return this.changeService.createRequest(userId, id, dto);
  }

  @Post(":user_id/change-requests/:request_id/cancel")
  @HttpCode(HttpStatus.OK)
  cancelChangeRequest(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("request_id", ParseIntPipe) requestId: number,
  ) {
    return this.changeService.cancelRequest(userId, requestId);
  }

  /** «Aceptar cambio» (D8: 409 payment_required when delta > 0). */
  @Post(":user_id/change-proposals/:proposal_id/accept")
  @HttpCode(HttpStatus.OK)
  acceptChangeProposal(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("proposal_id", ParseIntPipe) proposalId: number,
  ) {
    return this.changeService.acceptProposal(userId, proposalId);
  }

  /** «Mantener mi reserva actual». */
  @Post(":user_id/change-proposals/:proposal_id/reject")
  @HttpCode(HttpStatus.OK)
  rejectChangeProposal(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("proposal_id", ParseIntPipe) proposalId: number,
  ) {
    return this.changeService.rejectProposal(userId, proposalId);
  }

  @Post(":user_id/alternatives/:alternative_id/accept")
  @HttpCode(HttpStatus.OK)
  acceptAlternative(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("alternative_id", ParseIntPipe) alternativeId: number,
  ) {
    return this.alternativeService.accept(userId, alternativeId);
  }

  @Post(":user_id/alternatives/:alternative_id/reject")
  @HttpCode(HttpStatus.OK)
  rejectAlternative(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("alternative_id", ParseIntPipe) alternativeId: number,
  ) {
    return this.alternativeService.reject(userId, alternativeId);
  }
}
