export class UnknownAdapterError extends Error {
  constructor(name: string, kind: string, knownNames: string[]) {
    const known = knownNames.length > 0 ? knownNames.join(', ') : '(none registered)';
    super(`Unknown ${kind} adapter "${name}". Known adapters: ${known}`);
    this.name = 'UnknownAdapterError';
  }
}

export class MissingCredentialError extends Error {
  constructor(name: string, kind: string, missing: string[]) {
    super(`${kind} adapter "${name}" is missing required credential(s): ${missing.join(', ')}`);
    this.name = 'MissingCredentialError';
  }
}

/** Resolves named credentials (e.g. CI variables or user-config fields) for adapter construction. */
export interface CredentialSource {
  get(key: string): string | undefined;
}

export class EnvCredentialSource implements CredentialSource {
  get(key: string): string | undefined {
    const value = process.env[key];
    return value === '' ? undefined : value;
  }
}

export class MapCredentialSource implements CredentialSource {
  constructor(private readonly map: Readonly<Record<string, string | undefined>>) {}

  get(key: string): string | undefined {
    const value = this.map[key];
    return value === '' ? undefined : value;
  }
}

export interface AdapterDefinition<T, TOptions = void> {
  name: string;
  requiredCredentials: string[];
  factory: (credentials: Record<string, string>, options: TOptions) => T;
}

/**
 * Config-driven registry (design D2): adapters are named and statically
 * registered inside the container, then selected at runtime by name with
 * credentials resolved from a {@link CredentialSource} (CI env vars for
 * pipeline jobs, user-config fields for local commands).
 *
 * `TOptions` carries non-secret construction context that isn't a credential
 * (e.g. an ADO organization/project/wikiIdentifier read from committed
 * `.docs/config.yaml`) — pass `void` when an adapter kind needs none.
 */
export class AdapterRegistry<T, TOptions = void> {
  private readonly definitions = new Map<string, AdapterDefinition<T, TOptions>>();

  constructor(private readonly kind: string) {}

  register(definition: AdapterDefinition<T, TOptions>): void {
    this.definitions.set(definition.name, definition);
  }

  names(): string[] {
    return [...this.definitions.keys()];
  }

  create(name: string, source: CredentialSource, options: TOptions): T {
    const definition = this.definitions.get(name);
    if (!definition) {
      throw new UnknownAdapterError(name, this.kind, this.names());
    }

    const credentials: Record<string, string> = {};
    const missing: string[] = [];
    for (const key of definition.requiredCredentials) {
      const value = source.get(key);
      if (value === undefined) {
        missing.push(key);
      } else {
        credentials[key] = value;
      }
    }
    if (missing.length > 0) {
      throw new MissingCredentialError(name, this.kind, missing);
    }

    return definition.factory(credentials, options);
  }
}
