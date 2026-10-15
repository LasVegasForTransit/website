import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';
import { updateCommitteeSettings } from '../src/committee-settings';
import { loadDiscordPlan, discordPlanIsCurrent } from '../src/discord-plan';

const guildId = '111111111111111111';
const memberRoleId = '222222222222222222';
const committeeRoleId = '333333333333333333';
const leadRoleId = '444444444444444444';
const newerLeadRoleId = '555555555555555555';

void test('committee lead roles follow the current assignment while other committee access remains independent', async () => {
  const f = await mergeFixture();
  try {
    const input = {
      description: 'Organize events.',
      timeCommitment: 'Two hours a month',
      acceptingMembers: true,
      workspaceGroupEmail: null,
      discordRoleId: committeeRoleId,
      discordLeadRoleId: leadRoleId,
      interestIds: ['events' as const],
      expectedVersion: 1,
      operationId: 'lead-settings',
    };
    const saved = await updateCommitteeSettings(f.db, f.actor, 'events', input);
    assert.equal(saved.kind, 'ok');
    assert.equal(
      'discordLeadRoleId' in saved.value ? saved.value.discordLeadRoleId : undefined,
      leadRoleId,
      'an administrator must be able to save a separate lead channel role',
    );
    await f.people.linkIdentity(f.survivor.id, {
      platform: 'discord',
      externalId: '666666666666666666',
      linkMethod: 'self_linked',
    });
    const assignment = await f.committees.assign({
      personId: f.survivor.id,
      committeeId: 'events',
      role: 'member',
      actorId: f.admin.id,
      operationId: 'member-assignment',
    });
    assert.equal(assignment.kind, 'ok');
    const request = { personId: f.survivor.id, guildId, memberRoleId };
    assert.deepEqual((await loadDiscordPlan(f.db, request))?.desiredRoleIds, [
      memberRoleId,
      committeeRoleId,
    ]);
    await f.committees.changeRole(assignment.value.id, 'lead', f.admin.id, 'promote');
    const lead = await loadDiscordPlan(f.db, request);
    assert.ok(lead);
    assert.deepEqual(lead.desiredRoleIds, [memberRoleId, committeeRoleId, leadRoleId]);
    assert.equal(
      lead.targets.find((target) => target.resourceId === leadRoleId)?.expectedAccess,
      true,
    );
    await f.committees.changeRole(assignment.value.id, 'member', f.admin.id, 'step-back');
    assert.equal(await discordPlanIsCurrent(f.db, lead), false);
    assert.deepEqual((await loadDiscordPlan(f.db, request))?.desiredRoleIds, [
      memberRoleId,
      committeeRoleId,
    ]);
    assert.equal(
      (
        await updateCommitteeSettings(f.db, f.actor, 'events', {
          ...input,
          discordLeadRoleId: newerLeadRoleId,
          expectedVersion: 2,
          operationId: 'replace-lead',
        })
      ).kind,
      'ok',
    );
    const retired = await loadDiscordPlan(f.db, request);
    assert.ok(retired);
    assert.ok(retired.managedRoleIds.includes(leadRoleId));
    assert.ok(retired.managedRoleIds.includes(newerLeadRoleId));
    assert.equal(
      retired.targets.find((target) => target.resourceId === leadRoleId)?.expectedAccess,
      false,
    );
  } finally {
    f.db.raw.close();
  }
});

void test('lead channel changes require a current lead assignment and receive separate provider evidence', async () => {
  const f = await mergeFixture();
  try {
    await updateCommitteeSettings(f.db, f.actor, 'events', {
      description: '',
      timeCommitment: '',
      acceptingMembers: true,
      workspaceGroupEmail: null,
      discordRoleId: committeeRoleId,
      discordLeadRoleId: leadRoleId,
      interestIds: [],
      expectedVersion: 1,
      operationId: 'lead-proof-settings',
    });
    await f.people.linkIdentity(f.survivor.id, {
      platform: 'discord',
      externalId: '666666666666666666',
      linkMethod: 'self_linked',
    });
    const assigned = await f.committees.assign({
      personId: f.survivor.id,
      committeeId: 'events',
      role: 'lead',
      actorId: f.admin.id,
      operationId: 'lead-proof-assignment',
    });
    assert.equal(assigned.kind, 'ok');
    const plan = await loadDiscordPlan(f.db, { personId: f.survivor.id, guildId, memberRoleId });
    assert.ok(plan);
    const { claimDiscordLease, saveDiscordSync } = await import('../src/discord-sync-store');
    const { prepareDiscordChange, confirmDiscordChanges } =
      await import('../src/discord-change-audit');
    const now = new Date();
    const lease = await claimDiscordLease(f.db, plan, now);
    assert.ok(lease);
    const input = {
      plan,
      lease,
      now,
      operationId: 'lead-proof-assignment',
      member: {
        user: { id: '666666666666666666', username: 'fixture', displayName: null, avatar: null },
        roles: [memberRoleId, committeeRoleId, leadRoleId],
        pending: false,
        nickname: null,
      },
    };
    assert.equal(
      await prepareDiscordChange(f.db, input, { resourceId: leadRoleId, wasGranted: false }),
      true,
    );
    assert.equal(await confirmDiscordChanges(f.db, input), true);
    assert.equal(await saveDiscordSync(f.db, input), true);
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT count(*) AS n FROM access_observations WHERE target_id='committee_lead:events' AND resource_id=? AND state='granted'",
        )
        .get(leadRoleId)?.n,
      1,
    );
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT count(*) AS n FROM staff_audits WHERE action='access.granted' AND json_extract(details,'$.targetId')='committee_lead:events'",
        )
        .get()?.n,
      1,
    );
    const { listAccess, accessHistory } = await import('../src/access-view');
    const history = await accessHistory(f.db, f.actor, {
      personId: f.survivor.id,
      committeeId: 'events',
      providersOnly: true,
    });
    assert.equal(
      history.items.find((row) => row.action === 'access.granted')?.committeeName,
      'Events Committee leads',
    );
    const access = await listAccess(f.db, f.actor, { personId: f.survivor.id });
    assert.equal(
      access.items.find((row) => row.targetId === 'committee_lead:events')?.committeeName,
      'Events Committee leads',
    );
    await f.committees.changeRole(assigned.value.id, 'member', f.admin.id, 'proof-step-back');
    assert.equal(
      await prepareDiscordChange(f.db, input, { resourceId: leadRoleId, wasGranted: false }),
      false,
    );
  } finally {
    f.db.raw.close();
  }
});

void test('committee roles remain independent and retired lead roles cannot be reused as member roles', async () => {
  const f = await mergeFixture();
  try {
    const base = {
      description: '',
      timeCommitment: '',
      acceptingMembers: true,
      workspaceGroupEmail: null,
      interestIds: [],
      expectedVersion: 1,
      operationId: 'events-roles',
      discordRoleId: committeeRoleId,
      discordLeadRoleId: leadRoleId,
    };
    assert.equal((await updateCommitteeSettings(f.db, f.actor, 'events', base)).kind, 'ok');
    const advocacyRole = '777777777777777777';
    assert.equal(
      (
        await updateCommitteeSettings(f.db, f.actor, 'advocacy', {
          ...base,
          operationId: 'advocacy-role',
          discordRoleId: advocacyRole,
          discordLeadRoleId: null,
        })
      ).kind,
      'ok',
    );
    await f.people.linkIdentity(f.survivor.id, {
      platform: 'discord',
      externalId: '666666666666666666',
      linkMethod: 'self_linked',
    });
    const assignments = [];
    for (const committeeId of ['events', 'advocacy']) {
      const result = await f.committees.assign({
        personId: f.survivor.id,
        committeeId,
        role: 'lead',
        actorId: f.admin.id,
        operationId: 'assign-' + committeeId,
      });
      assert.equal(result.kind, 'ok');
      assignments.push(result.value);
    }
    const request = { personId: f.survivor.id, guildId, memberRoleId };
    assert.deepEqual((await loadDiscordPlan(f.db, request))?.desiredRoleIds, [
      memberRoleId,
      committeeRoleId,
      leadRoleId,
      advocacyRole,
    ]);
    assert.equal(
      (
        await f.committees.endAssignment(
          assignments[0]?.id ?? '',
          'stepped_back',
          f.admin.id,
          'leave-events',
        )
      ).kind,
      'ok',
    );
    assert.deepEqual((await loadDiscordPlan(f.db, request))?.desiredRoleIds, [
      memberRoleId,
      advocacyRole,
    ]);
    assert.equal(
      (
        await updateCommitteeSettings(f.db, f.actor, 'events', {
          ...base,
          expectedVersion: 2,
          operationId: 'clear-lead',
          discordLeadRoleId: null,
        })
      ).kind,
      'ok',
    );
    assert.equal(
      (
        await updateCommitteeSettings(f.db, f.actor, 'events', {
          ...base,
          expectedVersion: 3,
          operationId: 'reuse-lead',
          discordRoleId: leadRoleId,
          discordLeadRoleId: null,
        })
      ).kind,
      'conflict',
    );
    assert.equal(
      (
        await updateCommitteeSettings(f.db, f.actor, 'advocacy', {
          ...base,
          expectedVersion: 2,
          operationId: 'steal-lead',
          discordRoleId: advocacyRole,
        })
      ).kind,
      'conflict',
    );
  } finally {
    f.db.raw.close();
  }
});
