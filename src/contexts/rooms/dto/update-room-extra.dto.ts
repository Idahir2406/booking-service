import { PartialType } from "@nestjs/mapped-types";

import { CreateRoomExtraDto } from "./create-room-extra.dto";

export class UpdateRoomExtraDto extends PartialType(CreateRoomExtraDto) {}
