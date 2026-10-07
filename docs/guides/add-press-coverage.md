# Add press coverage

Use this guide to add a news story or interview featuring Las Vegans for Better Transit to the
public [LVBT in the press](https://lasvegasfortransit.org/press/) page. After the one-time setup,
staff add and edit coverage in Notion; no code change or website deploy is needed.

## One-time setup

Create a database named **LVBT Press** in the LVBT Notion workspace with these properties:

| Property  | Notion type | What goes here                 |
| --------- | ----------- | ------------------------------ |
| Headline  | Title       | The article's headline         |
| Outlet    | Text        | The publication or broadcaster |
| Published | Date        | The article's publication date |
| URL       | URL         | Link to the original article   |

Connect the Notion integration used by the LVBT website to this database. Copy its data source ID
from the database menu and set `LVBT_PRESS_DATA_SOURCE_ID` alongside the existing
`LVBT_NOTION_API_KEY` in the website's local and production Worker environments. Run
`pnpm bootstrap --phase secrets` to configure production values.

## Add or update an entry

1. Open **LVBT Press** in Notion and add a row.
2. Fill in the headline, outlet, publication date, and original article URL.
3. Once all four fields are valid, the article appears on `/press`, newest first. Incomplete rows
   stay off the public page.

Changes usually appear within five minutes. Editing a row updates its listing; deleting a row
removes it after the same cache period.
