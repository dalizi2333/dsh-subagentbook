// Contract fixture for independent, credential-free host gates.
export function teachingFixture(entries = {}) {
  const definitions = new Map();
  return {
    autoInjectionEnabled: false,
    definition: key => definitions.get(key),
    register: (key, definition) => definitions.set(key, structuredClone(definition)),
    resolveOverride: (key, model, provider) => definitions.has(key) ? entries[key]?.[model] ?? entries[key]?.[provider] ?? entries[key]?.default : undefined,
    resolve(key, model, provider) { return this.resolveOverride(key, model, provider) ?? definitions.get(key)?.fallback; },
  };
}
