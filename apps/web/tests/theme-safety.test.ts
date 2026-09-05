/**
 * Every colour in the UI must come from a role token.
 *
 * The subscription panels rendered white in dark mode because an inline style
 * reached for `var(--slate-50)` — a value from the shared ramp, which is the same
 * in both themes. Only the role tokens (`--surface-2`, `--border`, `--ok-fg`…) are
 * reassigned per theme, so anything else is a light-mode value frozen into the
 * markup. This test fails on a raw ramp reference or a colour literal in either the
 * components or the component layer of the stylesheet.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx') || full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** A raw ramp value, or any literal colour. */
const RAW_COLOUR = /var\(--(?:slate|indigo)-\d+\)|#[0-9a-fA-F]{3,8}\b|\brgba?\(/;

describe('components only use themed colour tokens', () => {
  const files = walk(SRC).filter((f) => !f.endsWith('styles.css'));

  for (const file of files) {
    const name = file.slice(SRC.length);
    it(`${name} has no frozen colour`, () => {
      const offenders: string[] = [];
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        // SVG icons legitimately carry their own fill/stroke via currentColor only.
        if (/<(svg|path|rect|circle|g)\b/.test(line)) return;
        if (!/style=|background|borderTop|borderBottom|borderLeft|borderRight|border:|color:/.test(line)) return;
        if (RAW_COLOUR.test(line)) offenders.push(`${i + 1}: ${line.trim()}`);
      });
      expect(offenders, `use a role token instead:\n${offenders.join('\n')}`).toEqual([]);
    });
  }
});

describe('the stylesheet keeps raw values inside the theme blocks', () => {
  it('no component rule references a ramp value directly', () => {
    const css = readFileSync(join(SRC, 'styles.css'), 'utf8').split('\n');
    const offenders: string[] = [];
    let depth = 0;
    let inTheme = false;

    css.forEach((line, i) => {
      if (/^\s*(:root|\[data-theme='(light|dark)'\])\s*\{/.test(line)) {
        inTheme = true;
        depth = 1;
        return;
      }
      if (inTheme) {
        depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
        if (depth <= 0) inTheme = false;
        return;
      }
      if (line.includes('url(') || line.includes('svg')) return;
      if (/var\(--(?:slate|indigo)-\d+\)|#[0-9a-fA-F]{6}\b/.test(line)) {
        offenders.push(`${i + 1}: ${line.trim()}`);
      }
    });

    expect(offenders, `move these into a theme block:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('defines every role token in both themes', () => {
    const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
    const block = (theme: string) => {
      const start = css.indexOf(`[data-theme='${theme}']`);
      expect(start, `${theme} theme block missing`).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf('\n}', start));
    };
    const names = (s: string) => new Set([...s.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]!));

    const light = names(block('light'));
    const dark = names(block('dark'));

    // A token defined in one theme but not the other silently falls back to the
    // :root ramp, which is exactly how a light value leaks into dark mode.
    expect([...light].filter((n) => !dark.has(n))).toEqual([]);
    expect([...dark].filter((n) => !light.has(n))).toEqual([]);
  });
});
