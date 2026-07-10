import { describe, expect, it } from 'vitest';
import {
  AdapterRegistry,
  MapCredentialSource,
  MissingCredentialError,
  UnknownAdapterError,
} from '../../../src/adapters/registry.js';

interface Widget {
  name: string;
  token: string;
}

function buildRegistry(): AdapterRegistry<Widget> {
  const registry = new AdapterRegistry<Widget>('widget');
  registry.register({
    name: 'acme',
    requiredCredentials: ['ACME_TOKEN'],
    factory: (creds) => ({ name: 'acme', token: creds.ACME_TOKEN! }),
  });
  return registry;
}

describe('AdapterRegistry', () => {
  it('constructs a registered adapter when all credentials are present', () => {
    const registry = buildRegistry();
    const widget = registry.create(
      'acme',
      new MapCredentialSource({ ACME_TOKEN: 'secret' }),
      undefined,
    );
    expect(widget).toEqual({ name: 'acme', token: 'secret' });
  });

  it('throws UnknownAdapterError for an unregistered name and lists known adapters', () => {
    const registry = buildRegistry();
    expect(() => registry.create('bogus', new MapCredentialSource({}), undefined)).toThrow(
      UnknownAdapterError,
    );
    try {
      registry.create('bogus', new MapCredentialSource({}), undefined);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownAdapterError);
      expect((err as Error).message).toContain('acme');
      expect((err as Error).message).toContain('bogus');
    }
  });

  it('throws MissingCredentialError naming every absent credential', () => {
    const registry = buildRegistry();
    expect(() => registry.create('acme', new MapCredentialSource({}), undefined)).toThrow(
      MissingCredentialError,
    );
    try {
      registry.create('acme', new MapCredentialSource({ ACME_TOKEN: '' }), undefined);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingCredentialError);
      expect((err as Error).message).toContain('ACME_TOKEN');
    }
  });

  it('treats empty-string credential values as absent', () => {
    const registry = buildRegistry();
    expect(() =>
      registry.create('acme', new MapCredentialSource({ ACME_TOKEN: '' }), undefined),
    ).toThrow(MissingCredentialError);
  });

  it('lists registered adapter names', () => {
    const registry = buildRegistry();
    expect(registry.names()).toEqual(['acme']);
  });
});
