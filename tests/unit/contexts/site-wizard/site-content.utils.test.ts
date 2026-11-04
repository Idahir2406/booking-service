import { describe, expect, it } from "vitest";

import {
  CONTENT_LIMITS,
  contentImagesFrom,
  decodeHtmlEntities,
  escapeHtmlText,
  htmlToPlainText,
  maxPhotosFor,
  parseContentInput,
  sanitizeRichText,
  toShortDescription,
} from "@/contexts/site-wizard/utils/site-content.utils";

function errorsOf(body: unknown): string[] {
  const result = parseContentInput(body);
  return result.ok ? [] : result.errors;
}

describe("decodeHtmlEntities / htmlToPlainText", () => {
  it("decodes legacy named and numeric entities", () => {
    expect(
      decodeHtmlEntities("C&aacute;lida &amp; m&aacute;s &#8364; &#x41;"),
    ).toBe("Cálida & más € A");
    expect(decodeHtmlEntities("&unknown; &#0;")).toBe("&unknown; &#0;");
  });

  it("strips tags, scripts and collapses whitespace", () => {
    expect(
      htmlToPlainText(
        "<p><br />Hotel c&eacute;ntrico</p>\n<script>alert(1)</script><p>en Baiona</p>",
      ),
    ).toBe("Hotel céntrico en Baiona");
  });

  it("keeps a lone '<' that is not a tag", () => {
    expect(htmlToPlainText("a < b y c > d")).toBe("a < b y c > d");
  });

  it("short description round trip: escaped on write, decoded on read", () => {
    const text = 'Perros "bienvenidos" & gatos <3';
    expect(toShortDescription(escapeHtmlText(text))).toBe(text);
  });
});

describe("sanitizeRichText", () => {
  it("keeps whitelisted tags and drops every attribute", () => {
    expect(
      sanitizeRichText(
        "<p class='x' data-start='0'><strong data-end='1'>Hola</strong> <em>mundo</em></p>",
      ),
    ).toBe("<p><strong>Hola</strong> <em>mundo</em></p>");
  });

  it("turns headings into p and unwraps unknown tags", () => {
    expect(
      sanitizeRichText("<h2 id='a'>Título</h2><div><span>Texto</span></div>"),
    ).toBe("<p>Título</p>Texto");
  });

  it("removes script/style with their content and event handlers", () => {
    expect(
      sanitizeRichText(
        "<p onclick='x()'>ok</p><script>alert(1)</script><style>p{}</style><img src=x onerror=alert(1)>",
      ),
    ).toBe("<p>ok</p>");
    expect(sanitizeRichText("<p>a</p><script>never closed")).toBe("<p>a</p>");
  });

  it("drops javascript links but keeps their text", () => {
    expect(sanitizeRichText("<a href='javascript:alert(1)'>link</a>")).toBe(
      "link",
    );
  });

  it("lists and line breaks", () => {
    expect(sanitizeRichText("<ul><li>Uno<br/>dos</li><li>tres</li></ul>")).toBe(
      "<ul><li>Uno<br>dos</li><li>tres</li></ul>",
    );
  });

  it("balances unclosed and ignores stray closing tags", () => {
    expect(sanitizeRichText("<p><strong>abc</p></em>")).toBe(
      "<p><strong>abc</strong></p>",
    );
    expect(sanitizeRichText("<p>abc")).toBe("<p>abc</p>");
  });

  it("escapes stray angle brackets and removes comments", () => {
    expect(sanitizeRichText("<p>1 < 2 <!-- x --></p>")).toBe(
      "<p>1 &lt; 2 </p>",
    );
  });

  it("empty markup -> empty string", () => {
    expect(sanitizeRichText("<p> </p><br>")).toBe("");
    expect(sanitizeRichText(null)).toBe("");
  });
});

describe("parseContentInput", () => {
  it("partial: only keys present", () => {
    expect(parseContentInput({ description_short: " Hola  " })).toEqual({
      ok: true,
      value: { description_short: "Hola" },
    });
    expect(parseContentInput({})).toEqual({ ok: true, value: {} });
  });

  it("short is plain text (tags stripped) and null clears", () => {
    expect(
      parseContentInput({
        description_short: "<b>Casa</b>\n rural",
        description_long: null,
      }),
    ).toEqual({
      ok: true,
      value: { description_short: "Casa rural", description_long: "" },
    });
  });

  it("long is sanitized", () => {
    expect(
      parseContentInput({ description_long: "<h1>T</h1><script>x</script>" }),
    ).toEqual({ ok: true, value: { description_long: "<p>T</p>" } });
  });

  it("limits and types", () => {
    expect(
      errorsOf({ description_short: "a".repeat(CONTENT_LIMITS.SHORT_MAX) }),
    ).toEqual([]);
    expect(
      errorsOf({ description_short: "a".repeat(CONTENT_LIMITS.SHORT_MAX + 1) }),
    ).toEqual(["description_short: máximo 400 caracteres"]);
    expect(
      errorsOf({
        description_long: `<p>${"a".repeat(CONTENT_LIMITS.LONG_MAX)}</p>`,
      }),
    ).toEqual(["description_long: máximo 20000 caracteres"]);
    expect(errorsOf({ description_short: 5, foo: 1 })).toEqual([
      "foo: campo desconocido",
      "description_short: debe ser texto",
    ]);
    expect(errorsOf("x")).toEqual(["body: formato no válido"]);
  });
});

describe("photos", () => {
  it("max photos by premium (legacy photo tab)", () => {
    expect(maxPhotosFor(0)).toBe(2);
    expect(maxPhotosFor(1)).toBe(35);
    expect(maxPhotosFor(4)).toBe(35);
  });

  it("non-empty slots in order", () => {
    expect(
      contentImagesFrom({
        image1: "1-cover.webp",
        image2: "",
        image3: null,
        image4: " 4.webp ",
      }),
    ).toEqual([
      { slot: 1, file: "1-cover.webp" },
      { slot: 4, file: "4.webp" },
    ]);
    expect(contentImagesFrom()).toEqual([]);
  });
});
