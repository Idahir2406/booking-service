import { PartialType } from "@nestjs/mapped-types";

import { CreateBlocksDto } from "./create-blocks.dto";

export class UpdateBlocksDto extends PartialType(CreateBlocksDto) {}
