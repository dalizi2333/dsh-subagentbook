import { TASK_TOOL_NAMES } from './definition.js';

// Registration defaults are baseline DSH description excerpts, not optimized
// MiMo teaching. Runtime uses localized hits only; no hit keeps the live schema.
const defaults = {
  bash: 'Execute a bash command (`bash -c`) and return its stdout/stderr.',
  glob: 'Find files, not directories, whose paths match a glob pattern, including hidden and ignored files.',
  read: 'Read a UTF-8 text file and return line-numbered content.',
  grep: 'Search file contents with a ripgrep regular expression. Returns matching lines with line numbers, grouped by file.',
  edit: 'Edit an existing UTF-8 text file by replacing literal text.',
  write: 'Create or fully replace a UTF-8 text file.',
  web_search: 'Search the web for current information. Returns an optional summary answer and a list of source URLs.',
  web_fetch: 'Fetch the content of a specific HTTP(S) URL and return it decoded to text.',
};
export function registerToolTeaching(promptbook) {
  for (const name of TASK_TOOL_NAMES) {
    const key = `tool.${name}`;
    if (!promptbook.definition(key)) promptbook.register(key, { label: `工具 · ${name}`, fallback: defaults[name] });
  }
  if (!promptbook.definition('tool.bash.only')) promptbook.register('tool.bash.only', { label: '工具 · bash（仅 Bash）', fallback: defaults.bash });
}
