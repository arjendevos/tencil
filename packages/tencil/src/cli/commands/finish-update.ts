import pc from 'picocolors';
import { finishUpdate, readPlan } from '../../service/self-update.ts';
import { time } from '../format.ts';

/** Move the daemon to a staged version (see `service/self-update.ts`). Logs to daemon.log. */
export async function finishUpdateCommand(planPath: string | undefined): Promise<void> {
    if (!planPath) throw new Error('finish-update needs the update plan');
    const plan = readPlan(planPath);
    const log = (message: string) => console.log(`${pc.dim(time())} ${message}`);
    log(`Updating the daemon on port ${plan.port} to Tencil ${plan.version}`);
    const updated = await finishUpdate(plan);
    log(
        updated
            ? `Tencil ${plan.version} is running`
            : `Tencil ${plan.version} didn't start; went back to the previous version`,
    );
}
