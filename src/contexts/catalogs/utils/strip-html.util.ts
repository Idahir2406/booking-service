const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

/** Legacy rich text -> plain text: tags removed, common entities decoded, spaces collapsed. */
export function stripHtml(value: string | null | undefined): string {
  return (value ?? "")
    .replaceAll(/<[^>]*>/g, " ")
    .replaceAll(
      /&(?:nbsp|amp|lt|gt|quot|apos|#39);/g,
      entity => HTML_ENTITIES[entity] ?? entity,
    )
    .replaceAll(/\s+/g, " ")
    .trim();
}
