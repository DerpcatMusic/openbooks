/** A new entity's id from its name: lowercase ASCII slug (≤ 32, the server's rule), else the kind's prefix ("il", "us", "other");
 * "-2", "-3", … when taken. */
export function entityId(name: string, kind: string, taken: readonly string[]) {
  const base =
    name
      .normalize("NFKD")
      .replace(/\p{M}/gu, "") // é → e, not "e-"
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 28)
      .replace(/-$/, "") || kind.split("-")[0]!;
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}
