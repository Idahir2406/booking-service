import { Transform, type TransformFnParams, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

import { TIPO_DE_ALQUILER_IDS } from "../utils/site-property.utils";

// Transforms read the RAW body value (obj[key]): with enableImplicitConversion
// the incoming `value` may already be coerced (e.g. "" -> 0 for numbers).
function raw({ obj, key }: TransformFnParams): unknown {
  return (obj as Record<string, unknown>)[key];
}

function trimmed(params: TransformFnParams): unknown {
  const value = raw(params);
  return typeof value === "string" ? value.trim() : value;
}

function trimmedOrNull(params: TransformFnParams): unknown {
  const value = trimmed(params);
  return value === "" ? null : value;
}

function digitsOrNull(params: TransformFnParams): unknown {
  const value = raw(params);
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value !== "string") {
    return value;
  }
  const compact = value.replaceAll(/[\s-]/g, "");
  return compact === "" ? null : compact;
}

function coordinateOrNull(params: TransformFnParams): unknown {
  const value = raw(params);
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const text = value.trim().replace(",", ".");
    return text === "" ? null : Number(text);
  }
  return value;
}

const MAX_TEXT = 255;
const MAX_IDS = 50;

export class UpdateSitePropertyDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TEXT)
  name!: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(MAX_TEXT)
  email!: string;

  @IsOptional()
  @Transform(trimmedOrNull)
  @IsEmail()
  @MaxLength(MAX_TEXT)
  email2?: string | null;

  @Transform(trimmed)
  @IsString()
  @Matches(/^\+?[\d\s]{6,20}$/, {
    message: "telefono must contain only digits, spaces and + (6-20 chars)",
  })
  telefono!: string;

  @IsOptional()
  @Transform(trimmedOrNull)
  @IsString()
  @Matches(/^\+\d{1,4}$/, {
    message: "whatsapp_prefix must look like +34",
  })
  whatsapp_prefix?: string | null;

  @IsOptional()
  @Transform(digitsOrNull)
  @IsString()
  @Matches(/^\d{6,15}$/, {
    message: "whatsapp_number must contain 6-15 digits",
  })
  whatsapp_number?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  main_tipsite_id!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IDS)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  tipsite?: number[];

  @Type(() => Number)
  @IsInt()
  @IsIn(TIPO_DE_ALQUILER_IDS)
  tipo_de_alquiler!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  id_provincia!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  id_poblacion!: number;

  @IsOptional()
  @Transform(coordinateOrNull)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  geolat?: number | null;

  @IsOptional()
  @Transform(coordinateOrNull)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  geolng?: number | null;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(MAX_TEXT)
  interes?: string | null;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(MAX_TEXT)
  distancia?: string | null;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(MAX_TEXT)
  ubicacion?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  tipenv!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IDS)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  tipdest?: number[];
}
