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
  | `${Worker}.version`
  | `${Worker}.upload`
  | `${Worker}.activation`
  | `${Worker}.readback`
  | 'deployment';

/** Only locally chosen stages may cross the CLI boundary; never provider error messages. */
export class DeploymentFailure extends Error {
  constructor(readonly stage: DeploymentStage) {
    super(
      `Staff preview stopped at ${stage}. Inspect the saved receipt and matching configuration checks before retrying.`,
    );
    this.name = 'DeploymentFailure';
  }
}

export async function deploymentStep<T>(stage: DeploymentStage, run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    throw error instanceof DeploymentFailure ? error : new DeploymentFailure(stage);
  }
}
