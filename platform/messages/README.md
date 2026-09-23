# Message catalog

Every word on member-facing and staff screens comes from this catalog, so LVBT can add a language later without rebuilding screens. English (`en.ts`) is the only published language. Spanish isn't offered until a volunteer can write and review it; machine translation is never published.

The catalog runs on the server and at build time only, so it adds no JavaScript to pages.

## Use a message

```ts
import { t } from '../platform/messages';

t('join.heading'); // "Join LVBT"
t('welcome.headingNamed', { name: 'Ana' }); // "You're in, Ana."
```

Dates and times use `formatDate` and `formatTime`, which always read in Pacific Time (`America/Los_Angeles`): "Sat, Oct 3" and "6:30 pm".

## Add a message

1. Add the key to `en.ts`, under the screen it belongs to. Write the text to the [copy standard for app screens](../../docs/explanation/app-copy.md).
2. Use it in code with `t('screen.key')`.
3. Run `pnpm test:unit`. A test fails if a key used in code is missing from the catalog, or if a catalog key is used nowhere, and names the key.

To fill in a value, write `{name}` in the text and pass `{ name: '…' }`.

For text that depends on a number, write the forms as an object and pass `count`:

```ts
tries: { one: 'You have {count} try left.', other: 'You have {count} tries left.' },
t('screen.tries', { count: 4 }); // "You have 4 tries left."
```

## Test with longer text

`createTranslator(en, 'en-XA')` renders every message about 40 percent longer, with accented letters, like `[Ĵöïñ ĹVBŢ · · ·]`. It shows where a layout would break in a longer language without anyone needing to speak one. It is for tests and local development only.

## Add a language later

A translator copies `en.ts` to a new file with the same keys, such as `es.ts`, and translates each value. A developer then adds the language to `index.ts` so the lookup can choose it from the person's preferred language.
