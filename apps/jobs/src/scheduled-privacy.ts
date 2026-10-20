import {
  acknowledgeScheduledSignal,
  nextProfileWork,
  nextInactiveWork,
  nextRecordWork,
  nextScheduledHour,
  type ScheduledSignal,
} from '@lasvegasfortransit/platform-storage/scheduled-wake';
import { memberPrivacySchedule } from '@lasvegasfortransit/platform-storage/member-privacy-schedule';
import { membershipStep } from './scheduled-budget';
import type { ScheduledAdmission } from './scheduled-admission';

async function runMaintenanceGroup(
  signal: ScheduledSignal,
  now: Date,
  context: ExecutionContext,
  admission: ScheduledAdmission,
) {
  const { budget, db } = admission;
  if (signal.name === 'records') {
    if (!signal.configuration && now.getUTCMinutes() !== 0) return nextScheduledHour(now);
    await membershipStep(budget, 'staff_maintenance', () =>
      context.exports.StaffMaintenance.run(now.getTime()),
    );
    return await nextRecordWork(db, now);
  }
  if (signal.name === 'profiles') {
    await membershipStep(budget, 'profile_maintenance', () =>
      context.exports.ProfileMaintenance.run(now.getTime()),
    );
    return await nextProfileWork(db, now);
  }
  if (memberPrivacySchedule(now))
    await membershipStep(budget, 'inactive_profile_maintenance', () =>
      context.exports.InactiveProfileMaintenance.run(now.getTime()),
    );
  return await nextInactiveWork(db, now);
}
export async function runDueMaintenance(
  now: Date,
  context: ExecutionContext,
  admission: ScheduledAdmission,
) {
  for (const name of ['records', 'profiles', 'inactive']) {
    const signal = admission.signals.find((item) => item.name === name);
    if (!signal) continue;
    const next = await runMaintenanceGroup(signal, now, context, admission);
    await acknowledgeScheduledSignal(admission.db, signal, admission.configuration, next);
  }
}
