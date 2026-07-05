import { PartialType } from "@nestjs/mapped-types";

import { CreateRoomBoardOptionDto } from "./create-room-board-option.dto";

export class UpdateRoomBoardOptionDto extends PartialType(
  CreateRoomBoardOptionDto,
) {}
