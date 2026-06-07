/* eslint-disable import/no-named-as-default */
import { describe, expect, it } from 'vitest';
import collectPlugin, { collectPlugin as named } from './index.js';

describe('@code-pushup/collect-plugin public API', () => {
  it('exports the plugin as default and named', () => {
    expect(collectPlugin).toBe(named);
    expect(typeof collectPlugin).toBe('function');
  });

  it('produces a valid PluginConfig with all required fields', () => {
    const cfg = collectPlugin();
    expect(cfg).toMatchObject({
      slug: 'portal',
      title: 'Portal',
      audits: expect.arrayContaining([
        expect.objectContaining({ slug: 'persist-runs' }),
      ]),
      groups: [],
    });
    expect(typeof cfg.runner).toBe('function');
  });
});
