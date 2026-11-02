// Creation belongs to its trigger, even when the title graph is very tall.
function AnchoredPanel({ anchor, id, label, onClose, children }) {
  const panel = react.useRef(null);
  const close = react.useRef(onClose);
  close.current = onClose;
  react.useLayoutEffect(() => {
    if (!anchor || !panel.current) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect(), el = panel.current;
      if (!el) return;
      if (!anchor.isConnected || rect.bottom < 0 || rect.top > window.innerHeight) { close.current(); return; }
      const margin = 12, gap = 8;
      el.style.width = `${Math.min(420, window.innerWidth - margin * 2)}px`;
      const below = window.innerHeight - rect.bottom - gap - margin, above = rect.top - gap - margin;
      const down = below >= Math.min(el.scrollHeight, 300) || below >= above;
      const room = Math.max(80, down ? below : above);
      el.style.maxHeight = `${room}px`;
      el.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - el.offsetWidth - margin))}px`;
      el.style.top = `${Math.max(margin, down ? rect.bottom + gap : rect.top - gap - Math.min(el.scrollHeight, room))}px`;
    };
    const outside = event => {
      if (panel.current?.contains(event.target) || anchor.contains(event.target) || event.target.closest?.('.sb-pop')) return;
      close.current();
    };
    const escape = event => {
      if (event.key !== 'Escape' || panel.current?.closest('.sb-scope')?.querySelector('.sb-pop:not(.closing)')) return;
      event.preventDefault(); close.current(); anchor.focus({ preventScroll: true });
    };
    place();
    panel.current.querySelector('input,textarea,button')?.focus({ preventScroll: true });
    const observer = new ResizeObserver(place); observer.observe(panel.current);
    window.addEventListener('resize', place); document.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', escape);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', escape); };
  }, [anchor]);
  return h('div', { ref: panel, id, className: 'sb-create-pop', role: 'dialog', 'aria-label': label, 'aria-modal': false },
    h('div', { className: 'sb-create-title' }, label), children);
}
