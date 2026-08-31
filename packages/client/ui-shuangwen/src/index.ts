/**
 * Shuangwen writing mode, node half.
 *
 * Deliberately empty. The shuangwen experience is the preset's persona plus a
 * browser-side quick-action strip: neither is a host capability, and mounting
 * a tool here would put it in every agent's catalog no matter which preset
 * composed it. The writer's only tool — filesystem save — lives on the
 * `shuangwen` preset, exactly like the other preset-owned tool rows.
 */

/** Host plugin body — the writing mode owns no host-plane surface. */
export function apply(): void {}
