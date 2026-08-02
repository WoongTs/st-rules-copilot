interface StoredValue {
  value: string;
  expiresAt?: number;
}

export class MemoryKV {
  readonly values = new Map<string, StoredValue>();

  async get(key: string): Promise<string | null>;
  async get<T>(key: string, options: { type: "json" }): Promise<T | null>;
  async get(
    key: string,
    options?: { type?: string } | string
  ): Promise<string | unknown | null> {
    const stored = this.values.get(key);
    if (!stored) {
      return null;
    }

    if (stored.expiresAt && stored.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }

    const type = typeof options === "string" ? options : options?.type;
    return type === "json" ? JSON.parse(stored.value) : stored.value;
  }

  async put(
    key: string,
    value: string,
    options?: KVNamespacePutOptions
  ): Promise<void> {
    this.values.set(key, {
      value,
      expiresAt: options?.expirationTtl
        ? Date.now() + options.expirationTtl * 1000
        : undefined
    });
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async list(options?: KVNamespaceListOptions): Promise<{
    keys: Array<{ name: string }>;
    list_complete: true;
    cacheStatus: null;
  }> {
    const prefix = options?.prefix ?? "";
    const limit = options?.limit ?? 1_000;
    const keys: Array<{ name: string }> = [];

    for (const [name, stored] of this.values) {
      if (stored.expiresAt && stored.expiresAt <= Date.now()) {
        this.values.delete(name);
        continue;
      }
      if (name.startsWith(prefix)) {
        keys.push({ name });
      }
    }

    keys.sort((left, right) => left.name.localeCompare(right.name));
    return {
      keys: keys.slice(0, limit),
      list_complete: true,
      cacheStatus: null
    };
  }
}
