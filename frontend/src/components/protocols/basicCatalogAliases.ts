import { Catalog, type ComponentApi } from "@a2ui/web_core/v0_9";

// SDK 0.10 moved this URL. Backend messages and saved surfaces still use it.
// Share the installed implementations, including the patched openUrl function.
export const LEGACY_BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9/basic_catalog.json";

export function withBasicCatalogAliases<T extends ComponentApi>(catalog: Catalog<T>): Catalog<T>[] {
  if (catalog.id === LEGACY_BASIC_CATALOG_ID) return [catalog];
  return [catalog, new Catalog(
    LEGACY_BASIC_CATALOG_ID,
    [...catalog.components.values()],
    [...catalog.functions.values()],
    catalog.themeSchema,
  )];
}
