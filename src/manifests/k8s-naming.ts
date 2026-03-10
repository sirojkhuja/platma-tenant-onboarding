export function toTenantSlug(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!slug) return "tenant";

  // Keep room for suffixes like "-<shortId>" and stay comfortably below K8s limits.
  return slug.slice(0, 40).replace(/-$/g, "");
}

export function shortIdFromUuid(uuid: string): string {
  return uuid.replace(/-/g, "").slice(0, 8) || "00000000";
}

export function noderedResourceName(tenantSlug: string, tenantId: string): string {
  return `nodered-${tenantSlug}-${shortIdFromUuid(tenantId)}`;
}

