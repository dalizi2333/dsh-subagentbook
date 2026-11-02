const STYLES = `
.sb-scope { color:var(--dsw-alias-label-primary); font-size:13px; }
.sb-scope * { box-sizing:border-box; }
.sb-scope button,.sb-scope input,.sb-scope select,.sb-scope textarea { font:inherit; color:inherit; }
.sb-card { position:relative; background:var(--dsw-alias-bg-module-platform); border:0; padding:16px; corner-shape:superellipse(1.43); border-radius:12px; }
.sb-head { display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding:16px 16px 24px; }
.sb-head h3 { font-size:14px; margin:0 10px 0 0; }
.sb-titlecard { padding:0; transition:border-radius .26s cubic-bezier(.2,0,0,1),margin .26s; }
.sb-titlecard.expanded { margin-bottom:20px; }
.sb-heading-trigger { display:inline-flex; gap:12px; align-items:center; min-width:0; max-width:100%; padding:3px 6px; margin-left:-6px; border:0; border-radius:8px; corner-shape:superellipse(1.43); background:transparent; cursor:pointer; }
.sb-heading-trigger:hover { background:var(--dsw-alias-interactive-bg-hover); }
.sb-heading-trigger:focus-visible { outline:2px solid #56ae83; outline-offset:2px; }
.sb-heading-title { font-size:14px; font-weight:600; flex:none; }
.sb-heading-trigger > span:nth-child(2) { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sb-header-expand { display:grid; grid-template-rows:0fr; transition:grid-template-rows .26s cubic-bezier(.2,0,0,1); }
.sb-header-expand.open { grid-template-rows:1fr; }
.sb-header-expand-inner { overflow:hidden; min-height:0; visibility:hidden; }
.sb-header-expand.open .sb-header-expand-inner { visibility:visible; }
.sb-button { border:0; border-radius:8px; corner-shape:superellipse(1.43); background:transparent; cursor:pointer; padding:6px 10px; }
.sb-button:hover { background:var(--dsw-alias-interactive-bg-hover); }
.sb-button:disabled { opacity:.4; cursor:default; }
.sb-primary { color:#56ae83 !important; }
.sb-warning { color:#d6af58 !important; }
.sb-rowwrap { margin-top:-12px; transition:margin .26s cubic-bezier(.2,0,0,1); }
.sb-rowwrap.open { margin-top:8px; margin-bottom:20px; }
.sb-rowwrap .sb-card { border-radius:0; padding:12px 16px 18px; transition:border-radius .26s cubic-bezier(.2,0,0,1); }
.sb-line { display:flex; gap:10px; align-items:center; min-height:20px; cursor:pointer; border-radius:10px; }
.sb-rowwrap:not(.open) .sb-line:hover { background:var(--dsw-alias-interactive-bg-hover); }
.sb-dot { width:8px; height:8px; flex:none; border-radius:50%; background:#83888e; transition:background-color .15s ease; }
.sb-dot.saved,.sb-dot.saving { background:#22c55e; }
.sb-dot.inherited { background:#eab308; }
.sb-dot.invalid,.sb-dot.failed { background:#d57777; }
.sb-dot.saving { animation:sb-saving .8s ease-in-out infinite alternate; }
@keyframes sb-saving { to { opacity:.35; } }
.sb-field { flex:0 0 148px; }
.sb-value { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--dsw-alias-label-secondary); }
.sb-source { max-width:0; opacity:0; overflow:hidden; white-space:nowrap; color:var(--dsw-alias-label-tertiary); transform:translateX(12px); transition: max-width .26s,opacity .2s,transform .26s; }
.sb-line:hover .sb-source,.open .sb-source { max-width:200px; opacity:1; transform:translateX(0); }
.sb-editorwrap { display:grid; grid-template-rows:0fr; transition:grid-template-rows .26s cubic-bezier(.2,0,0,1); }
.open .sb-editorwrap { grid-template-rows:1fr; }
.sb-editor { overflow:hidden; min-height:0; visibility:hidden; }
.open .sb-editor { visibility:visible; }
.sb-fields { display:grid; gap:8px; padding-top:14px; }
.sb-input,.sb-ta { width:100%; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; corner-shape:superellipse(1.43); background:var(--dsw-alias-bg-base); padding:8px 10px; outline:none; }
.sb-ta { min-height:90px; resize:vertical; }
.sb-input:focus,.sb-ta:focus { border-color:#56ae83; }
.sb-tools { display:flex; flex-wrap:wrap; align-items:center; gap:6px; width:100%; min-height:42px; padding:7px 8px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; corner-shape:superellipse(1.43); background:var(--dsw-alias-bg-base); cursor:text; }
.sb-tools:focus-within { border-color:#56ae83; }
.sb-tools.invalid { border-color:#d57777; }
.sb-tools.disabled { opacity:.4; cursor:default; }
.sb-tool-tag { display:inline-flex; align-items:center; gap:4px; max-width:100%; padding:3px 4px 3px 9px; border-radius:8px; corner-shape:superellipse(1.43); background:rgba(86,174,131,.18); color:var(--dsw-alias-label-primary); }
.sb-tool-tag > span { overflow-wrap:anywhere; }
.sb-tool-tag.invalid { background:rgba(213,119,119,.18); color:#d57777; }
.sb-tool-remove { display:inline-flex; align-items:center; justify-content:center; flex:none; width:20px; height:20px; padding:0; border:0; border-radius:100%; corner-shape:superellipse(1.43); background:transparent; color:var(--dsw-alias-label-secondary) !important; cursor:pointer; line-height:1; transition:background-color .15s ease; }
.sb-tool-remove:hover:not(:disabled) { background:rgba(86,174,131,.26); }
.sb-tool-remove:focus-visible { outline:2px solid #56ae83; outline-offset:1px; }
.sb-tool-remove:disabled { cursor:default; }
.sb-tool-input { flex:1 1 150px; min-width:100px; max-width:100%; width:150px; padding:4px 2px; border:0; outline:none; background:transparent; }
.sb-tool-input::placeholder { color:var(--dsw-alias-label-tertiary); }
.sb-tool-error { color:#d57777; font-size:12px; margin:8px 0 0; overflow-wrap:anywhere; }
.sb-tool-known { display:block; margin-top:4px; color:var(--dsw-alias-label-tertiary); }
.sb-actions { display:flex; gap:10px; justify-content:flex-end; align-items:center; margin-top:10px; }
.sb-icon { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; padding:0; border:0; border-radius:100%; corner-shape:superellipse(1.43); cursor:pointer; color:#fff; transition:background-color .15s ease,opacity .15s ease; }
.sb-icon:disabled { opacity:.4; cursor:default; }
.sb-icon,.sb-collapsebtn { position:relative; z-index:3; }
.sb-iconsave { background:rgba(34,197,94,.35); }
.sb-iconsave:hover:not(:disabled) { background:#22c55e; }
.sb-iconsave svg path { stroke:#15803d; transition:stroke .15s ease; }
.sb-iconsave:hover:not(:disabled) svg path { stroke:#fff; }
.sb-iconclear { background:rgba(234,179,8,.35); }
.sb-iconclear:hover:not(:disabled) { background:#eab308; }
.sb-clearglyph { fill:#a16207; stroke:#a16207; stroke-width:1.5; transition:fill .15s ease,stroke .15s ease; }
.sb-clearink { fill:none; stroke:#c7950a; stroke-width:4.5; transition:stroke .15s ease; }
.sb-iconclear:hover:not(:disabled) .sb-clearglyph { fill:#fff; stroke:#fff; }
.sb-iconclear:hover:not(:disabled) .sb-clearink { stroke:#eab308; }
.sb-collapsebtn { border:0; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; border-radius:14px; corner-shape:superellipse(1.43); width:66px; height:28px; padding:0; display:inline-flex; align-items:center; justify-content:center; font-size:13px; flex:none; }
.sb-trigger { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); background: 0 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 3px 10px; cursor: pointer; }
.sb-trigger:hover { background: var(--dsw-alias-interactive-bg-hover); }
.sb-caret { font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.sb-pop { box-sizing: border-box; position: fixed; z-index: 1000; background: var(--dsw-alias-bg-module-platform); border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; box-shadow: 0 10px 28px rgba(0,0,0,.18); padding: 6px; animation: sb-pop-down .2s cubic-bezier(.2,0,0,1); }
.sb-pop.closing { pointer-events: none; opacity: 0; transform: scaleY(.96); transform-origin: top; transition: opacity .2s ease, transform .2s cubic-bezier(.2,0,0,1); }
@keyframes sb-pop-down { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.sb-pophead { font-size: 12px; color: var(--dsw-alias-label-tertiary); padding: 2px 10px 4px; }
.sb-popline { display: flex; align-items: center; gap: 10px; width: 100%; padding: 5px 8px; cursor: pointer; border-radius: 8px; border: 0; background: 0 0; font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); text-align: left; white-space: nowrap; overflow: hidden; transition: padding .26s cubic-bezier(.2,0,0,1), background .15s ease; }
/* 悬浮行横向展开破卡而出（D24）：完整名称放得下，展开行自带浮层质感 */
.sb-popline:hover { position: relative; z-index: 1; width: max-content; min-width: 100%; padding: 5px 14px; background: var(--dsw-alias-bg-module-platform); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; box-shadow: 0 10px 28px rgba(0,0,0,.18); }
.sb-popline.active { background: var(--dsw-alias-interactive-bg-hover); }
.sb-popmeta { margin-left: auto; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.sb-trigger { corner-shape:superellipse(1.43); justify-self:start; max-width:100%; }
.sb-trigger:disabled { opacity:.4; cursor:default; }
.sb-pop { max-width:calc(100vw - 16px); }
.sb-pophead { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sb-popline span { overflow:hidden; text-overflow:ellipsis; }
.sb-note { font-size:12px; color:var(--dsw-alias-label-tertiary); }
.sb-error { color:#d57777; white-space:pre-wrap; margin:8px 0; }
.sb-details { margin:14px 0; }
.sb-details summary { cursor:pointer; color:var(--dsw-alias-label-secondary); }
.sb-details pre { white-space:pre-wrap; word-break:break-word; padding:12px; max-height:400px; overflow:auto; }
.sb-dialog { margin-top:12px; display:grid; gap:8px; }
.sb-create-pop { position:fixed; z-index:900; display:grid; gap:10px; padding:16px; overflow:auto; overscroll-behavior:contain; background:var(--dsw-alias-bg-module-platform); border:1px solid var(--dsw-alias-border-l2); border-radius:16px; corner-shape:superellipse(1.43); box-shadow:0 12px 40px rgba(0,0,0,.22); }
.sb-create-title { font-weight:600; font-size:13px; }
.sb-create-names { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:8px; }
.sb-create-pop .sb-actions,.sb-create-pop .sb-error { margin:0; }
.sb-role-added { padding:0 16px 12px; color:#56ae83; font-size:12px; }
.sb-route-missing { color:#d6af58; }
.sb-inline-line { min-height:28px; cursor:default; }
.sb-inline-value { display:flex; align-items:center; flex:1; min-width:0; color:var(--dsw-alias-label-secondary); }
.sb-inline-value .sb-trigger,.sb-depth-trigger { border:1px solid transparent; border-radius:8px; corner-shape:superellipse(1.43); background:transparent; color:inherit; padding:2px 6px; margin-left:-7px; height:26px; cursor:pointer; max-width:100%; white-space:nowrap; }
.sb-inline-value .sb-trigger:hover,.sb-depth-trigger:hover { background:var(--dsw-alias-interactive-bg-hover); }
.sb-inline-value .sb-trigger:focus-visible,.sb-depth-trigger:focus-visible { outline:2px solid #56ae83; outline-offset:1px; }
.sb-depth-trigger { overflow:hidden; text-overflow:ellipsis; cursor:text; }
.sb-depth-trigger:disabled { opacity:.4; cursor:default; }
.sb-depth-input { width:104px; max-width:100%; height:26px; padding:2px 6px; margin-left:-7px; }
.sb-depth-trigger.invalid,.sb-depth-input[aria-invalid="true"] { border-color:#d57777; }
.sb-inline-actions { display:flex; flex:none; align-items:center; gap:10px; opacity:0; visibility:hidden; pointer-events:none; transition:opacity .15s ease; }
.sb-inline-actions .sb-button { padding:3px 6px; font-size:12px; }
.sb-inline-line:hover .sb-inline-actions,.sb-inline-line:focus-within .sb-inline-actions,.sb-inline-actions.visible { opacity:1; visibility:visible; pointer-events:auto; }
.sb-inline-line:focus-within .sb-source { max-width:200px; opacity:1; transform:translateX(0); }
.sb-inline-error { margin:6px 0 0 18px; font-size:12px; }
.sb-options { display:grid; gap:20px; }
.sb-option { display:grid; grid-template-columns:148px minmax(0,1fr); gap:8px 18px; align-items:center; }
.sb-option-label { color:var(--dsw-alias-label-secondary); }
.sb-option-controls { display:flex; align-items:center; gap:8px; min-width:0; }
.sb-option-mapping { font-size:11px; color:var(--dsw-alias-label-tertiary); opacity:0; transition:opacity .15s; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sb-option:hover .sb-option-mapping,.sb-option:focus-within .sb-option-mapping { opacity:1; }
.sb-budget-number { width:132px; padding:5px 8px; }
.sb-budget-number[aria-invalid="true"] { border-color:#d57777; }
.sb-option-default { font-size:12px !important; color:var(--dsw-alias-label-tertiary) !important; }
.sb-range { grid-column:2; appearance:none; width:100%; max-width:380px; min-width:0; margin:0; height:22px; cursor:pointer; background:transparent; }
.sb-range::-webkit-slider-runnable-track { height:3px; border-radius:3px; background:var(--dsw-alias-border-l2); }
.sb-range::-webkit-slider-thumb { appearance:none; height:16px; width:16px; margin-top:-6.5px; border:0; border-radius:100%; corner-shape:superellipse(1.43); background:#56ae83; box-shadow:0 0 0 3px rgba(86,174,131,.12); }
.sb-range::-moz-range-track { height:3px; border-radius:3px; background:var(--dsw-alias-border-l2); }
.sb-range::-moz-range-thumb { height:16px; width:16px; border:0; border-radius:50%; background:#56ae83; }
.sb-range:disabled { opacity:.35; cursor:default; }
.sb-range:focus-visible { outline:2px solid #56ae83; outline-offset:3px; border-radius:8px; }
.sb-effort-rail { grid-column:2; min-width:0; max-width:380px; }
.sb-effort-stops { display:flex; justify-content:space-between; gap:8px; margin-top:2px; font-size:11px; color:var(--dsw-alias-label-tertiary); }
.sb-effort-stops span { max-width:120px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sb-options > p { margin:0; }
.sb-custom-head { display:flex; align-items:center; gap:8px; }
.sb-custom-add { padding:2px 7px; font-size:18px !important; line-height:1; }
.sb-custom-field { padding:10px 0 4px; }
.sb-custom-line { display:flex; align-items:center; gap:10px; }
.sb-custom-name { width:156px; flex:none; text-align:left; padding:3px 0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sb-custom-value { width:140px; padding:5px 8px; }
.sb-custom-line .sb-tool-remove { opacity:0; transition:opacity .15s; }
.sb-custom-field:hover .sb-tool-remove,.sb-custom-field:focus-within .sb-tool-remove { opacity:1; }
.sb-custom-range { display:block; margin:6px 0 0 166px; width:calc(100% - 166px); }
.sb-field-settings { display:grid; grid-template-columns:minmax(120px,1fr) minmax(160px,2fr); gap:8px; margin:10px 0; max-width:650px; }
.sb-field-range { grid-column:1 / -1; display:flex; gap:8px; }
.sb-field-range input { width:0; flex:1; min-width:0; }
.sb-graph { padding:0 16px 16px; }
.sb-graph-toolbar { display:flex; align-items:center; gap:12px; }
.sb-graph-hint { margin-left:auto; cursor:help; }
.sb-graph-all-hint { margin:10px 0 0; }
.sb-graph-scroll { overflow:auto; max-height:420px; margin-top:12px; border-radius:12px; corner-shape:superellipse(1.43); background:radial-gradient(circle, var(--dsw-alias-border-l2) .7px, transparent .9px) 0 0 / 20px 20px; }
.sb-graph-scroll:focus-visible { outline:2px solid #56ae83; outline-offset:2px; }
.sb-graph-canvas { position:relative; margin:0 auto; }
.sb-graph-lines { display:block; position:absolute; inset:0; overflow:visible; }
.sb-graph-edge { fill:none; stroke:var(--dsw-alias-label-tertiary); stroke-width:1.2; opacity:.35; transition:opacity .15s,stroke .15s; }
.sb-graph-edge.active { stroke:#56ae83; stroke-width:1.7; opacity:.95; }
.sb-graph-edge.unavailable { stroke-dasharray:4 5; }
.sb-graph-node { position:absolute; transform:translate(-50%,-50%); display:flex; gap:8px; align-items:center; width:136px; height:42px; padding:8px 11px; border:1px solid var(--dsw-alias-border-l2); border-radius:14px; corner-shape:superellipse(1.43); background:var(--dsw-alias-bg-base); cursor:pointer; transition:opacity .15s,border-color .15s,box-shadow .15s; }
.sb-graph-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sb-graph-star { width:7px; height:7px; flex:none; border-radius:100%; corner-shape:superellipse(1.43); background:#56ae83; }
.sb-graph-node.muted { opacity:.6; }
.sb-graph-node.unavailable { border-style:dashed; }
.sb-graph-node.unavailable .sb-graph-star { background:var(--dsw-alias-label-tertiary); }
.sb-graph-node.selected,.sb-graph-node:hover,.sb-graph-node:focus-visible { border-color:#56ae83; box-shadow:0 0 0 3px rgba(86,174,131,.12); opacity:1; outline:none; }
.sb-graph-missing { margin-left:auto; color:var(--dsw-alias-label-tertiary); }
.sb-cycle-indicator { margin-left:auto; color:#c9942f !important; }
.sb-cycle-report { color:#c9942f; margin-top:10px; font-size:12px; }
.sb-cycle-report summary { cursor:pointer; }
.sb-cycle-members { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
.sb-cycle-members .sb-button { padding:3px 8px; background:rgba(201,148,47,.08); }
.sb-graph-edge.cycle { stroke:#c9942f; stroke-width:1.8; opacity:.95; }
.sb-graph-node.cycle { border-color:#c9942f; opacity:1; }
.sb-graph-node.cycle .sb-graph-star { background:#c9942f; }
.sb-graph-node.cycle.selected,.sb-graph-node.cycle:hover,.sb-graph-node.cycle:focus-visible { box-shadow:0 0 0 3px rgba(201,148,47,.16); }
`;
