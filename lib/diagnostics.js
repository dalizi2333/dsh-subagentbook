import { hostModules } from './composition.js';
import { INSTANCE_REMOTE, REPORT_EXPORT_REMOTE, CHECKPOINT_EXPORT_REMOTE, RECOVERY_REMOTE } from './diagnostics-contract.js';

export function installDiagnostics(ctx, runtime) {
  ctx.inject(['typert'], async local => {
    const host = await hostModules(local);
    const { TypertRemoteService } = await host.importPlugin('@deepseek-ai/dsh-typert-protocol');
    class Diagnostics extends TypertRemoteService {
      constructor(scope) { super(scope, INSTANCE_REMOTE.service); }
      inspect(sessionId) { return runtime.inspectInstance(sessionId); }
      prepareRecovery(sessionId) { return runtime.prepareRecovery(sessionId); }
      exportCheckpoint(sessionId) { return runtime.exportCheckpoint(sessionId); }
      exportReport(sessionId) { return runtime.exportReport(sessionId); }
    }
    // Public registry + visible Gateway binding, behind the host's authenticated
    // Remote carrier. No raw HTTP route or private host manager is patched.
    local.plugin(Diagnostics);
    local.typert.register({ package: '@mimo-codex/dsh-subagentbook/diagnostics', face: 'host',
      schemas: [], model: { services: [], events: [], objects: [] }, invocations: [INSTANCE_REMOTE, REPORT_EXPORT_REMOTE, CHECKPOINT_EXPORT_REMOTE, RECOVERY_REMOTE] });
  });
}
