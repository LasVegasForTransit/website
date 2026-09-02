// Single source of truth for the membership-intake Notion data source schema.
//
// Both the Pages Function (which writes property VALUES) and the provisioner
// script `scripts/notion/provision-intake-db.ts` (which creates the columns)
// import this, so a rename or a new column cannot desync the code from the
// database — the failure mode that shipped a `ZIP` the form never had.
//
// Underscore-prefixed so Cloudflare Pages does not treat it as a route.

// The Notion API version the endpoint and the provisioner both pin. Shared so a
// schema created at one version can't drift from writes made at another.
export const NOTION_VERSION = '2026-03-11';

export type NotionPropertyType = 'title' | 'email' | 'rich_text' | 'date' | 'url';

export interface IntakeProperty {
  /** Column name as it appears in Notion. */
  label: string;
  /** Notion property type, used when provisioning the data source. */
  type: NotionPropertyType;
}

export const INTAKE_PROPERTIES = {
  name: { label: 'Name', type: 'title' },
  email: { label: 'Email', type: 'email' },
  discord: { label: 'Discord', type: 'rich_text' },
  source: { label: 'Source', type: 'rich_text' },
  submittedAt: { label: 'Submitted at', type: 'date' },
  rawResponse: { label: 'Raw response', type: 'url' },
  responseId: { label: 'Response ID', type: 'rich_text' },
} as const satisfies Record<string, IntakeProperty>;

/**
 * Build the `initial_data_source.properties` object for the Notion
 * Create-a-database call (API version 2025-09-03+).
 */
export function intakeDataSourceProperties(): Record<string, Record<string, object>> {
  return Object.fromEntries(
    Object.values(INTAKE_PROPERTIES).map(({ label, type }) => [label, { [type]: {} }]),
  );
}
