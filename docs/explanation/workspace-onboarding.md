# Workspace account onboarding

An active human LVBT Workspace account receives a portal record and eligibility for basic staff
tools. Directory notifications start onboarding promptly, and a five-minute recovery scan catches
missed changes. The Google-hosted connector uses its attached identity and Google-managed signing
with a restricted Workspace administrator. Google credentials stay inside the connector; D1 stays
behind the site.

Human eligibility follows reviewed organizational-unit IDs and explicit inclusions/exclusions.
Workspace has no universal human-account flag. New or unclassified OUs await review, operational
accounts must use excluded OUs or IDs, and preview processes only approved test accounts with
separate write groups. Group claims and execution recheck the current preview account allowlist,
including work queued before an account was removed from that list. A failed or incomplete scan
never proves an account was deleted.

The immutable Google user ID identifies the account. An existing verified association is reused.
Otherwise enrollment creates an empty team record; a matching email or name cannot claim an
established person's membership or Discord account. An enrollee can explicitly connect an existing
member account after proving both accounts. Only an empty provisional record can transfer its
Workspace association. Independent activity or conflicting identities require administrator review.

Basic portal access is separate from membership and responsibilities. Enrollment creates no
newsletter consent, committee assignment or administrator grant. Active human former members can use
basic team tools while their former-member status and restrictions remain intact. The Console users
group admits eligible accounts; committee groups follow current explicit assignments under the
existing membership rules. Shared mappings retain access while another eligible assignment still
requires it. Independent Google readback confirms each plan's current account, revision and group;
accepting a job does not confirm access.

Suspension, archival or confirmed deletion pauses Workspace access, revokes staff sessions and
queues managed Google group removal. Saved membership and committee assignments remain intact.
Google suspension alone does not change Discord entitlements. Fresh active observations may resume
basic admission, but erased identities or explicit local revocations remain held for recovery.

Staff onboarding follows Account → Discord → Ready, with one decision per page. A new provisional
account first offers connection to an existing member account or use of the prepared Workspace
account. Existing verified associations skip that decision. Account connection requires proof of
both accounts; a matching email or name is not proof.

Every staff member must use Discord. Onboarding reuses an existing verified connection to the
configured LVBT server once screening is complete. Otherwise the owner connects Discord, authorizes
access and accepts the server rules. Cancellation stays in setup without restarting authorization.
Screening has its own step with Open Discord and Check again. Only a current confirmed connection
opens staff tools after the required-Discord rollout is enabled; administrator and committee-lead
roles do not bypass setup. Protected requests reuse fresh Discord observations. When an existing
verified connection’s cached observation expires, a private read-only refresh checks membership
before deciding admission, preserving the requested tool and any submitted form if it succeeds. An
unavailable provider or a departed member keeps the request in setup. Expired Discord observations
refresh automatically before a staff request proceeds; a failed check or departed account keeps
access gated.

The staff and public sites exchange one-time, browser-bound proof while keeping their secrets and
cookies separate. Google cannot authorize a new Discord identity. Team-only accounts can connect and
join without becoming members or gaining Member roles. Disconnected accounts are not silently
restored, and a departed server member may need fresh authorization. Operational access details
remain on the person's staff profile rather than interrupting onboarding.

The connector handles Google notifications, recovery scanning, channel renewal and group work.
Existing Cloudflare jobs retain Discord and newsletter scheduling. Google retries and D1 budgets are
separate so a Google failure cannot delay those providers. Both runtimes reject stale plans and
confirm changes through provider reads.

See the [connector deployment guide](../../apps/workspace-connector/docs/deployment.md) for runtime
configuration, activation prerequisites, verification, cost review and recovery. Source tests and
container validation do not establish live Directory or Discord acceptance. Production activation
follows an isolated preview trial, reviewed human-account backfill and approved resource changes.
