import { NewsletterAddressCipher } from './newsletter-address-cipher';
export interface NewsletterIntentContext {
  id: string;
  publicationId: string;
  personId: string;
}
export class NewsletterIntentCipher extends NewsletterAddressCipher<NewsletterIntentContext> {
  constructor(secret: string) {
    super(secret, (value) => [
      'newsletter-intent-v1',
      value.publicationId,
      value.personId,
      value.id,
    ]);
  }
}
