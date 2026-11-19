/**
 * The room every page sits in: warm ink, two drifting flame auras, manga
 * screentone at the edges and a film grain.
 *
 * Pure CSS (see .welcome-bg / .aura in globals.css) — no WebGL, so it costs
 * nothing to mount on every page and cannot fail on a weak GPU. `accent`
 * lets a page tint the third aura with the colour of whatever it is showing,
 * while the flame keeps every page recognisably the same app.
 */
export function InkBackdrop({ accent, quiet = false }: { accent?: string | null; quiet?: boolean }) {
  // Only a plain hex colour reaches the style attribute.
  const tint = accent && /^#[0-9a-f]{6}$/i.test(accent) ? accent : null;
  return (
    <div aria-hidden className={`welcome-bg pointer-events-none fixed inset-0 z-0 ${quiet ? 'quiet' : ''}`}>
      <div className="aura aura-a" />
      <div className="aura aura-b" />
      <div
        className="aura aura-c"
        style={tint ? { background: `radial-gradient(circle, ${tint}, transparent 65%)`, opacity: 0.28 } : undefined}
      />
      <div className="screentone" />
      <div className="grain" />
    </div>
  );
}
