import { Transform } from "class-transformer";
import { IsIn, IsOptional } from "class-validator";

import {
  BASE_LANG,
  SUPPORTED_LANGS,
  type SupportedLang,
} from "../legacy-db/legacy-tables";

export class LangQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsIn(SUPPORTED_LANGS)
  lang: SupportedLang = BASE_LANG;
}
