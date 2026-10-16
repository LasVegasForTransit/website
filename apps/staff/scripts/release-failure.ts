import {
  diagnosticSummary,
  safeDiagnostics,
  ReleaseDiagnosticError,
  type SafeDiagnostics,
} from './release-diagnostics';
type Worker = 'staff' | 'jobs';
export type DeploymentStage =
  | 'saved-build'
  | 'saved-artifact'
  | 'source-checkout'
  | 'saved-configuration'
  | 'receipt'
  | 'configuration'
  | 'recorded-traffic'
  | 'setup-boundary'
  | 'shutdown-boundary'
  | 'jobs.schedule'
  | `${Worker}.version`
  | `${Worker}.upload`
  | `${Worker}.activation`
  | `${Worker}.readback`
  | 'deployment';

/** Only locally chosen stages may cross the CLI boundary; never provider error messages. */
export class DeploymentFailure extends Error {
  readonly diagnostics?: SafeDiagnostics;
  constructor(
    readonly stage: DeploymentStage,
    error?: unknown,
  ) {
    const diagnostics = safeDiagnostics(error);
    super(
      `Staff release stopped at ${stage}.${diagnosticSummary(diagnostics)} Inspect the saved receipt and matching configuration checks before retrying.`,
    );
    this.name = 'DeploymentFailure';
    this.diagnostics = diagnostics;
  }
}

export async function deploymentStep<T>(stage: DeploymentStage, run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    throw error instanceof DeploymentFailure ? error : new DeploymentFailure(stage, error);
  }
}
export interface DeploymentCheck {
  stage: string;
  passed: boolean;
  diagnostics?: SafeDiagnostics;
}
export function deploymentDiagnostics(error: unknown) {
  return error instanceof DeploymentFailure && error.diagnostics
    ? { diagnostics: error.diagnostics }
    : {};
}
export function failedChecks(
  stage: DeploymentStage,
  checks: { id: string; status: string; diagnostics?: SafeDiagnostics }[],
): never {
  throw new DeploymentFailure(
    stage,
    new ReleaseDiagnosticError(checks, checks.find((check) => check.diagnostics)?.diagnostics),
  );
}
