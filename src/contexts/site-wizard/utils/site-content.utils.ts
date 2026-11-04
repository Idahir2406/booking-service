import type { ParseResult } from "./site-units.utils";

/**
 * Pure helpers of wizard step 5 ("Contenido"): descriptions of v4p_jsites2
 * (short = description1_l1, plain text; long = description2_l1, whitelisted
 * HTML) and the photo slots rule of the legacy photo tab. No I/O here.
 */

export const CONTENT_LIMITS = {
  SHORT_MAX: 400,
  LONG_MAX: 20_000,
  /** v4p_jsites2.image1..image35. */
  PHOTO_SLOTS: 35,
  /** premium = 0 (Free): the PHP photo tab only shows image1 + image2. */
  FREE_PHOTOS: 2,
} as const;

export interface ContentInput {
  description_short?: string;
  description_long?: string;
}

/** Highest Unicode code point (U+10FFFF). */
const MAX_CODE_POINT = 1_114_111;

const BODY_KEYS = ["description_short", "description_long"] as const;

/** Tags kept by sanitizeRichText (h1-h6 are turned into p). */
const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "ul",
  "ol",
  "li",
]);
const HEADING_TAG = /^h[1-6]$/;
const VOID_TAGS: ReadonlySet<string> = new Set(["br"]);

/** Elements dropped together with their content. */
const DROP_WITH_CONTENT =
  "script|style|template|noscript|iframe|object|embed|svg|math|head|title|textarea|select";

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  agrave: "à",
  egrave: "è",
  igrave: "ì",
  ograve: "ò",
  ugrave: "ù",
  Agrave: "À",
  Egrave: "È",
  Ograve: "Ò",
  auml: "ä",
  euml: "ë",
  iuml: "ï",
  ouml: "ö",
  uuml: "ü",
  Uuml: "Ü",
  Iuml: "Ï",
  ntilde: "ñ",
  Ntilde: "Ñ",
  ccedil: "ç",
  Ccedil: "Ç",
  middot: "·",
  iexcl: "¡",
  iquest: "¿",
  ordf: "ª",
  ordm: "º",
  deg: "°",
  euro: "€",
  laquo: "«",
  raquo: "»",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  copy: "©",
  reg: "®",
};

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasKey(source: RawRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

/** Named (common Latin-1/Spanish) and numeric entities -> characters. */
export function decodeHtmlEntities(value: string): string {
  return value.replaceAll(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, body: string) => {
      if (body.startsWith("#")) {
        const hex = body[1] === "x" || body[1] === "X";
        const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(code) && code > 0 && code <= MAX_CODE_POINT
          ? String.fromCodePoint(code)
          : entity;
      }
      return NAMED_ENTITIES[body] ?? entity;
    },
  );
}

/** Minimal escaping so plain text renders literally when PHP echoes it. */
export function escapeHtmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function removeDangerousBlocks(html: string): string {
  return html
    .replaceAll(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replaceAll(
      new RegExp(
        String.raw`<(${DROP_WITH_CONTENT})\b[^>]*>[\s\S]*?<\/\1\s*>`,
        "gi",
      ),
      "",
    )
    .replaceAll(
      new RegExp(String.raw`<(${DROP_WITH_CONTENT})\b[\s\S]*$`, "gi"),
      "",
    )
    .replaceAll(/<[!?][^>]*>/g, "");
}

/**
 * Stored/legacy HTML -> plain text: tags removed (block ends become spaces),
 * entities decoded, whitespace collapsed.
 */
export function htmlToPlainText(value: string | null | undefined): string {
  return decodeHtmlEntities(
    removeDangerousBlocks(value ?? "").replaceAll(/<\/?[a-zA-Z][^>]*>/g, " "),
  )
    .replaceAll(/\s+/g, " ")
    .trim();
}

/** Text between tags: keep entities, neutralize stray angle brackets. */
function sanitizeText(text: string): string {
  return text.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Whitelist sanitizer for the long description: only p, br, strong, b, em,
 * i, u, ul, ol, li survive (h1-h6 -> p), every attribute is dropped,
 * script/style/... are removed with their content, other tags are unwrapped
 * (content kept) and the output is balanced. Empty markup -> "".
 */
export function sanitizeRichText(value: string | null | undefined): string {
  const html = removeDangerousBlocks(value ?? "");
  const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  const stack: string[] = [];
  let out = "";
  let last = 0;

  for (const match of html.matchAll(tagPattern)) {
    out += sanitizeText(html.slice(last, match.index));
    last = match.index + match[0].length;

    const closing = match[1] === "/";
    const raw = match[2].toLowerCase();
    const tag = HEADING_TAG.test(raw) ? "p" : raw;
    if (!ALLOWED_TAGS.has(tag)) {
      continue;
    }
    if (VOID_TAGS.has(tag)) {
      if (!closing) {
        out += `<${tag}>`;
      }
      continue;
    }
    if (!closing) {
      stack.push(tag);
      out += `<${tag}>`;
      continue;
    }
    const openIndex = stack.lastIndexOf(tag);
    if (openIndex === -1) {
      continue;
    }
    while (stack.length > openIndex) {
      out += `</${stack.pop() ?? tag}>`;
    }
  }
  out += sanitizeText(html.slice(last));
  while (stack.length > 0) {
    out += `</${stack.pop() ?? ""}>`;
  }

  const trimmed = out.trim();
  return htmlToPlainText(trimmed) === "" ? "" : trimmed;
}

/** Stored short description (legacy may hold HTML) -> plain text. */
export function toShortDescription(value: string | null | undefined): string {
  return htmlToPlainText(value);
}

function readText(
  body: RawRecord,
  key: (typeof BODY_KEYS)[number],
  errors: string[],
): string | undefined {
  if (!hasKey(body, key)) {
    return undefined;
  }
  const raw = body[key];
  if (raw === null) {
    return "";
  }
  if (typeof raw !== "string") {
    errors.push(`${key}: debe ser texto`);
    return undefined;
  }
  return raw;
}

/**
 * Body of PUT /content. Partial: only the keys present are returned
 * (null = clear). short -> plain text <= 400; long -> sanitized HTML <= 20000.
 */
export function parseContentInput(body: unknown): ParseResult<ContentInput> {
  if (!isRecord(body)) {
    return { ok: false, errors: ["body: formato no válido"] };
  }
  const errors: string[] = [];
  for (const key of Object.keys(body)) {
    if (!(BODY_KEYS as readonly string[]).includes(key)) {
      errors.push(`${key}: campo desconocido`);
    }
  }

  const value: ContentInput = {};
  const short = readText(body, "description_short", errors);
  if (short !== undefined) {
    const text = htmlToPlainText(short);
    if (text.length > CONTENT_LIMITS.SHORT_MAX) {
      errors.push(
        `description_short: máximo ${CONTENT_LIMITS.SHORT_MAX} caracteres`,
      );
    } else {
      value.description_short = text;
    }
  }

  const long = readText(body, "description_long", errors);
  if (long !== undefined) {
    const html = sanitizeRichText(long);
    if (html.length > CONTENT_LIMITS.LONG_MAX) {
      errors.push(
        `description_long: máximo ${CONTENT_LIMITS.LONG_MAX} caracteres`,
      );
    } else {
      value.description_long = html;
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

/** Legacy photo tab: premium 0 shows 2 slots, any paid plan all 35. */
export function maxPhotosFor(premium: number): number {
  return premium > 0 ? CONTENT_LIMITS.PHOTO_SLOTS : CONTENT_LIMITS.FREE_PHOTOS;
}

/** jsites2 row -> non-empty image slots in slot order. */
export function contentImagesFrom(
  row?: Readonly<Record<string, unknown>>,
): { slot: number; file: string }[] {
  if (!row) {
    return [];
  }
  const images: { slot: number; file: string }[] = [];
  for (let slot = 1; slot <= CONTENT_LIMITS.PHOTO_SLOTS; slot += 1) {
    const raw = row[`image${slot}`];
    const file = typeof raw === "string" ? raw.trim() : "";
    if (file !== "") {
      images.push({ slot, file });
    }
  }
  return images;
}
