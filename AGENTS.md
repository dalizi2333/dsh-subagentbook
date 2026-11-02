# Subagentbook development

Use Node >=22. Run npm run build:client after editing src/client; never hand-edit lib/client.js. npm run ci is the local and GitHub CI gate. Supported DSH versions: 0.2.0-rc.2 and 0.2.1-rc.5. Keep permissions narrowing-only and existing instance snapshots immutable. Use public host APIs; do not patch private lifecycle managers. Tool teaching belongs to Promptbook. Do not commit credentials or local instance data.
