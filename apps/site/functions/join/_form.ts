/// <reference types="@cloudflare/workers-types" />

// Serving the built join form with a fresh token, or again after a failed
// submit with the visitor's input and errors. Shared by the real join form
// and its prototype. Underscore-prefixed so Pages does not route it.

import type { JoinErrors, JoinInput } from '@lasvegasfortransit/platform-core/join-form';
import { builtPage, finish, show, showText, type JoinEnv } from './_page';

export interface FormState {
  formToken: string;
  input?: JoinInput;
  errors?: JoinErrors;
  notice?: string;
  referral?: string | null;
}

const TEXT_FIELDS: [string, keyof JoinInput][] = [
  ['email', 'email'],
  ['given_name', 'givenName'],
  ['family_name', 'familyName'],
  ['zip', 'zip'],
  ['phone', 'phone'],
  ['address', 'address'],
  ['discord_username', 'discordUsername'],
];

function restoreTravelAnswers(rewriter: HTMLRewriter, input: JoinInput): HTMLRewriter {
  const checked = [...(input.ownsCar === 'yes' ? ['car'] : []), ...input.micromobility];
  for (const answer of checked) {
    rewriter = rewriter.on(`input[name="transport_options"][value="${answer}"]`, {
      element(element) {
        element.setAttribute('checked', '');
      },
    });
  }
  return rewriter;
}

export async function renderJoinForm(
  env: JoinEnv,
  request: Request,
  state: FormState & { path: string },
  status: number,
): Promise<Response> {
  const page = await builtPage(env, request, state.path);
  let rewriter = new HTMLRewriter().on('[data-slot="form-token"]', {
    element(element) {
      element.setAttribute('value', state.formToken);
    },
  });
  rewriter = rewriter.on('[data-slot="referral"]', {
    element(element) {
      element.setAttribute('value', state.input?.referral ?? state.referral ?? '');
    },
  });

  const { input, errors = {} } = state;
  if (input) {
    for (const [name, key] of TEXT_FIELDS) {
      const value = String(input[key]);
      rewriter = rewriter.on(`input[name="${name}"]`, {
        element(element) {
          element.setAttribute('value', value);
        },
      });
    }
    for (const interest of input.interests) {
      rewriter = rewriter.on(`input[name="interests"][value="${interest}"]`, {
        element(element) {
          element.setAttribute('checked', '');
        },
      });
    }
    rewriter = restoreTravelAnswers(rewriter, input);
    if (input.consent) {
      rewriter = rewriter.on('input[name="consent"]', {
        element(element) {
          element.setAttribute('checked', '');
        },
      });
    }
  }

  const failed = Object.keys(errors);
  if (failed.length > 0) {
    rewriter = rewriter.on('[data-slot="error-summary"]', show());
    for (const field of failed) {
      rewriter = rewriter
        .on(`[data-summary-for="${field}"]`, show())
        .on(`[data-error-for="${field}"]`, show())
        .on(`#${field}`, {
          element(element) {
            element.setAttribute('aria-invalid', 'true');
            const described = element.getAttribute('aria-describedby');
            element.setAttribute(
              'aria-describedby',
              described ? `${field}-error ${described}` : `${field}-error`,
            );
          },
        });
    }
  }
  if (state.notice) rewriter = rewriter.on('[data-slot="notice"]', showText(state.notice));

  return finish(rewriter.transform(page), status);
}
