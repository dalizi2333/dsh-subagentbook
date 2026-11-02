// A view of the editable book, not of frozen running instances. An exact model
// view never synthesizes routes for roles that do not declare that model.
function roleGraph(book, routeKey = '') {
  const all = routeKey === '*';
  const route = routeKey && !all ? safeParse(routeKey) : null;
  const nodes = book.presets.map(preset => {
    const routeIndex = route ? preset.models.findIndex(model => model.provider === route[0] && model.model === route[1]) : -1;
    const available = !route || routeIndex !== -1;
    const effective = { ...FIELD_DEFAULTS, ...preset.defaults, ...(routeIndex < 0 ? {} : preset.models[routeIndex].overrides) };
    return { id: preset.id, name: preset.name, description: preset.description, routeIndex, available,
      entry: book.entryPresets.includes(preset.id), effective, children: [] };
  });
  const byId = new Map(nodes.map(node => [node.id, node]));
  const edgeMap = new Map();
  const add = (node, ids, scope) => { for (const id of ids ?? []) {
    // Incomplete drafts may temporarily reference a deleted role. The editor's
    // validation remains authoritative; no phantom clickable nodes are created.
    if (!byId.has(id)) continue;
    const key = JSON.stringify([node.id, id]);
    if (!edgeMap.has(key)) edgeMap.set(key, { from: node.id, to: id, unavailable: !byId.get(id).available, ...(all ? { scopes: [] } : {}) });
    if (all) edgeMap.get(key).scopes.push(scope);
  } };
  for (const node of nodes) if (node.available) {
    add(node, node.effective.delegates, '');
    if (all) for (const model of book.presets.find(preset => preset.id === node.id).models) {
      add(node, model.overrides?.delegates ?? node.effective.delegates, JSON.stringify([model.provider, model.model]));
    }
  }
  const edges = [...edgeMap.values()];
  const cycles = roleCycles(nodes, edges);
  for (const node of nodes) if (node.cycle) {
    const scopes = edges.filter(edge => edge.from === node.id && edge.cycle).flatMap(edge => edge.scopes ?? []);
    node.cycleScope = all ? scopes.includes('') ? '' : scopes[0] : routeKey;
    const model = node.cycleScope ? safeParse(node.cycleScope) : null;
    node.cycleRouteIndex = model ? book.presets.find(preset => preset.id === node.id).models.findIndex(route => route.provider === model[0] && route.model === model[1]) : -1;
  }
  const incoming = new Set(edges.filter(edge => edge.from !== edge.to).map(edge => edge.to));
  const visited = new Set(), roots = [];
  // A breadth-first spanning forest gives stable positions for DAGs, shared
  // descendants and cycles. Additional edges stay visible without recursion.
  for (const start of [...nodes.filter(node => !incoming.has(node.id)), ...nodes]) {
    if (visited.has(start.id)) continue;
    roots.push(start); start.depth = 0; visited.add(start.id);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const parent = queue[i];
      for (const edge of edges) if (edge.from === parent.id && !visited.has(edge.to)) {
        const child = byId.get(edge.to); visited.add(child.id); child.depth = parent.depth + 1;
        parent.children.push(child); queue.push(child);
      }
    }
  }
  let row = 0;
  const place = node => {
    if (!node.children.length) node.y = 48 + row++ * 58;
    else { node.children.forEach(place); node.y = (node.children[0].y + node.children.at(-1).y) / 2; }
    node.x = 110 + node.depth * 178;
  };
  roots.forEach(place);
  const width = Math.max(500, ...nodes.map(node => node.x + 98));
  let height = Math.max(180, row * 58 + 36);
  const extent = Math.max(208, ...nodes.map(node => node.x + 98));
  nodes.forEach(node => { node.x += (width - extent) / 2; });
  // Center short books vertically, retaining room for curved back/self edges.
  if (row < 2) nodes.forEach(node => { node.y = height / 2; });
  // Back edges use separate gutters outside the node columns, instead of
  // running behind ancestor/intermediate cards. Keep every return arrow visible.
  let lane = Math.max(48, ...nodes.map(node => node.y)) + 40;
  for (const edge of edges) if (edge.from !== edge.to && byId.get(edge.to).x <= byId.get(edge.from).x) {
    edge.laneY = lane; height = Math.max(height, lane + 18); lane += 18;
  }
  return { nodes, edges, cycles, width, height };
}

// Strong components distinguish real cycles from ordinary diamonds/shared
// children. These are diagnostics only; they never become a save prohibition.
function roleCycles(nodes, edges) {
  const adjacency = new Map(nodes.map(node => [node.id, []]));
  edges.forEach(edge => adjacency.get(edge.from).push(edge.to));
  const indices = new Map(), low = new Map(), stack = [], active = new Set(), components = [];
  let index = 0;
  const visit = id => {
    indices.set(id, index); low.set(id, index++); stack.push(id); active.add(id);
    for (const next of adjacency.get(id)) {
      if (!indices.has(next)) { visit(next); low.set(id, Math.min(low.get(id), low.get(next))); }
      else if (active.has(next)) low.set(id, Math.min(low.get(id), indices.get(next)));
    }
    if (low.get(id) !== indices.get(id)) return;
    const component = [];
    let current;
    do { current = stack.pop(); active.delete(current); component.push(current); } while (current !== id);
    if (component.length > 1 || adjacency.get(id).includes(id)) components.push(component);
  };
  nodes.forEach(node => { if (!indices.has(node.id)) visit(node.id); });
  const order = new Map(nodes.map((node, i) => [node.id, i]));
  components.forEach(component => component.sort((a, b) => order.get(a) - order.get(b)));
  components.sort((a, b) => order.get(a[0]) - order.get(b[0]));
  const membership = new Map();
  components.forEach((component, i) => component.forEach(id => membership.set(id, i)));
  nodes.forEach(node => { if (membership.has(node.id)) node.cycle = true; });
  edges.forEach(edge => { if (membership.has(edge.from) && membership.get(edge.from) === membership.get(edge.to)) edge.cycle = true; });
  return components;
}

function RoleGraph({ graph, selected, onSelect, focusRole, t }) {
  const [hovered, setHovered] = react.useState('');
  const nodeRefs = react.useRef(new Map());
  react.useEffect(() => {
    if (!focusRole) return;
    const node = nodeRefs.current.get(focusRole);
    node?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); node?.focus({ preventScroll: true });
  }, [focusRole]);
  const marker = `sb-graph-${react.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const focused = byId.has(hovered) ? hovered : selected;
  const connected = new Set([focused]);
  graph.edges.forEach(edge => { if (edge.from === focused || edge.to === focused) { connected.add(edge.from); connected.add(edge.to); } });
  const title = node => [node.name, node.id, node.description,
    node.cycle ? t('graphCycleMember') : null,
    !node.available ? t('graphNoRoute') : null,
    `${t('tools')}: ${node.effective.tools?.join(', ') || '—'}`,
    `${t('actionScope')}: ${t(node.effective.actionScope === 'verification-copy' ? 'scopeVerification' : node.effective.actionScope === 'read-only' ? 'scopeReadOnly' : 'scopeInherit')}`,
    `${t('maxNestedDepth')}: ${node.effective.maxNestedDepth ?? t('inheritedDepth')}`,
    `${t('delegates')}: ${node.available ? node.effective.delegates.map(id => byId.get(id)?.name ?? id).join(', ') || '—' : '—'}`,
    node.entry ? t('entry') : null].filter(Boolean).join('\n');
  return h('div', null,
    graph.cycles.length ? h('details', { className: 'sb-cycle-report', role: 'status' },
      h('summary', { title: t('graphCycleHint') }, `${t('graphCycles')} · ${graph.cycles.length} ${t('graphCycleGroups')}`),
      ...graph.cycles.map((ids, i) => h('div', { className: 'sb-cycle-members', key: i },
        ...ids.map(id => { const node = byId.get(id); return h('button', { key: id, type: 'button', className: 'sb-button', title: `${t('graphFix')} · ${id} · ${node.cycleScope ? safeParse(node.cycleScope).join(' / ') : t('common')}`, 'aria-label': `${t('graphFix')} · ${node.name} (${id})`, onClick: () => onSelect(id, node.cycleRouteIndex, true) }, node.name); })))) : null,
    h('div', { className: 'sb-graph-scroll', role: 'region', 'aria-label': t('graph'), tabIndex: 0 },
    h('div', { className: 'sb-graph-canvas', style: { width: graph.width, height: graph.height } },
      h('svg', { className: 'sb-graph-lines', width: graph.width, height: graph.height, 'aria-hidden': true },
        h('defs', null, h('marker', { id: marker, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'context-stroke' }))),
        ...graph.edges.map(edge => {
          const from = byId.get(edge.from), to = byId.get(edge.to);
          const active = edge.from === focused || edge.to === focused;
          let d;
          if (from === to) d = `M ${from.x - 30} ${from.y - 21} C ${from.x - 55} ${from.y - 58}, ${from.x + 55} ${from.y - 58}, ${from.x + 30} ${from.y - 21}`;
          else if (to.x > from.x) d = `M ${from.x + 68} ${from.y} C ${(from.x + to.x) / 2} ${from.y}, ${(from.x + to.x) / 2} ${to.y}, ${to.x - 72} ${to.y}`;
          else {
            const right = from.x + 88, left = to.x - 88, lane = edge.laneY;
            d = `M ${from.x + 68} ${from.y + 6} L ${right - 8} ${from.y + 6} Q ${right} ${from.y + 6}, ${right} ${from.y + 14} L ${right} ${lane - 8} Q ${right} ${lane}, ${right - 8} ${lane} L ${left + 8} ${lane} Q ${left} ${lane}, ${left} ${lane - 8} L ${left} ${to.y + 14} Q ${left} ${to.y + 6}, ${left + 8} ${to.y + 6} L ${to.x - 72} ${to.y + 6}`;
          }
          return h('path', { key: canonical([edge.from, edge.to]), d, className: `sb-graph-edge${active ? ' active' : ''}${edge.unavailable ? ' unavailable' : ''}${edge.cycle ? ' cycle' : ''}`,
            markerEnd: `url(#${marker})` }, h('title', null, `${from.name} → ${to.name}${edge.cycle ? ` · ${t('graphCycleMember')}` : ''}${edge.unavailable ? ` · ${t('graphNoRoute')}` : ''}${edge.scopes ? `\n${edge.scopes.map(scope => scope ? safeParse(scope).join(' / ') : t('common')).join('\n')}` : ''}`));
        })),
      ...graph.nodes.map(node => h('button', { key: node.id, type: 'button', className: `sb-graph-node${node.id === selected ? ' selected' : ''}${!connected.has(node.id) ? ' muted' : ''}${!node.available ? ' unavailable' : ''}${node.cycle ? ' cycle' : ''}`,
        ref: el => { if (el) nodeRefs.current.set(node.id, el); else nodeRefs.current.delete(node.id); },
        style: { left: node.x, top: node.y }, title: title(node), 'aria-label': `${t('graphGo')} · ${node.name} (${node.id})`, 'aria-pressed': node.id === selected,
        'data-role-id': node.id, 'data-route-available': node.available,
        onMouseEnter: () => setHovered(node.id), onMouseLeave: () => setHovered(''), onFocus: () => setHovered(node.id), onBlur: () => setHovered(''),
        onClick: () => onSelect(node.id, node.routeIndex) },
        h('span', { className: 'sb-graph-star', 'aria-hidden': true }), h('span', { className: 'sb-graph-name' }, node.name),
        !node.available ? h('span', { className: 'sb-graph-missing', title: t('graphNoRoute'), 'aria-label': t('graphNoRoute') }, '◇') : null)))));
}
