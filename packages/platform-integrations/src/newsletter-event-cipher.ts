import { NewsletterAddressCipher } from './newsletter-address-cipher';
export interface NewsletterEventContext {
  id: string;
  publicationId: string;
  subscriptionId: string;
  emailKey: string;
}
export class NewsletterEventCipher extends NewsletterAddressCipher<NewsletterEventContext> {
  constructor(secret: string) {
    super(secret, (value) => [
      'newsletter-event-v1',
      value.publicationId,
      value.id,
      value.subscriptionId,
      value.emailKey,
    ]);
  }
}
