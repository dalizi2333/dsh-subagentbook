// Public lifecycle seams only. Keep exact activation disposal and native ownership.
export const usesActivations = service => typeof service.startActivation === 'function';
export const drainDescendants = (service, parents) => (service.drainDescendants ?? service.drainContinuableDescendants).call(service, parents);
export const drainChildren = (service, parent, ids) => (service.drainChildren ?? service.drainContinuableChildren).call(service, parent, ids);
export function startLocal(service, spec) {
  if (usesActivations(service)) return service.startActivation(spec);
  if (spec.delivery !== 'parent') throw new Error('Ephemeral activation requires the activation host');
  const { delivery: _delivery, ...legacy } = spec;
  return service.startContinuable(legacy);
}
