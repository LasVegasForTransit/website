import type { EventVenue } from './event-format';

// Calendar authors can select a named place without its street address. Enrich
// only this exact reviewed location; full calendar addresses take precedence.
// City of Las Vegas: https://www.lasvegasnevada.gov/Residents/Parks-Facilities/Huntridge-Circle-Park
export const verifiedCalendarVenues: Readonly<Record<string, EventVenue>> = {
  'Huntridge Park, Las Vegas, NV 89104, USA': {
    name: 'Huntridge Park',
    streetAddress: '1251 S. Maryland Parkway',
    addressLocality: 'Las Vegas',
    addressRegion: 'NV',
    postalCode: '89104',
    addressCountry: 'US',
  },
};
