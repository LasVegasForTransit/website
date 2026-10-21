# Message catalog

Contributors put text for member and staff screens in this message catalog, a shared collection of
named messages. Use it when you add or change screen text so a translator can add a language without
rewriting each screen. English (`en.ts`) is the only published language. LVBT will offer Spanish
when volunteers can write and review it; LVBT does not publish machine translation.

The server and build process read the catalog. The catalog adds no JavaScript to pages. Run the
commands below from the repository root after
[local setup](../../../../docs/tutorials/start-here.md).

## Use a message

```ts
import { t } from '@lasvegasfortransit/platform-core/messages';

t('join.heading'); // "Join LVBT"
t('welcome.headingNamed', { name: 'Ana' }); // "Welcome to LVBT, Ana!"
```

Dates and times use `formatDate` and `formatTime`, which always read in Pacific Time
(`America/Los_Angeles`): "Sat, Oct 3" and "6:30 pm".

## Add a message

1. Add the key under the screen it belongs to. Member groups live in `en.ts`; shared staff copy
   lives in `staff-common.ts`, member-record copy in `staff-people.ts` and access copy in
   `staff-access.ts`. These groups appear under `staff` in `en.ts`, so callers use keys such as
   `staff.people.search`. Write the text to the
   [copy standard for app screens](../../../../docs/explanation/app-copy.md).
2. Use it in code with `t('screen.key')`.
3. Run `pnpm check`. A test fails if a key used in code is missing from the catalog, or if a catalog
   key is used nowhere, and names the key.

To fill in a value, write `{name}` in the text and pass `{ name: '…' }`.

For text that depends on a number, write the forms as an object and pass `count`:

```ts
tries: { one: 'You have {count} try left.', other: 'You have {count} tries left.' },
t('screen.tries', { count: 4 }); // "You have 4 tries left."
```

## Test with longer text

The test language `en-XA` makes each message about 40 percent longer and adds accented letters, like
`[Ĵöïñ ĹVBŢ · · ·]`. It shows where a layout would break in a longer language without anyone needing
to speak one.

To see the whole site in it, build with `LVBT_PSEUDO_LOCALE=1`:

```sh
LVBT_PSEUDO_LOCALE=1 pnpm -C apps/site build
pnpm -C apps/site preview
```

Every page built this way says `lang="en-XA"`. The automated audit's "Long text (en-XA)" job builds
the site like this on every pull request and checks that the join and sign-in pages still fit a
320-pixel phone with nothing cut off. The production deploy refuses a build in `en-XA`. Messages the
server fills in on request, such as an error after a wrong code, stay in English in this build.

## Add a language later

A translator prepares a catalog with the same keys, including the staff groups, and translates each
value. A developer then adds the language to `index.ts` so the lookup can choose it from the
person's preferred language.
