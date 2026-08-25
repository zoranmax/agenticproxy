import * as vscode from 'vscode';
import { ProviderEntry } from '../types';

const STORAGE_KEY_PROVIDERS = 'agenticproxy.providers';

export class ProviderRegistry {
  private readonly _onDidChangeProviders = new vscode.EventEmitter<void>();
  public readonly onDidChangeProviders = this._onDidChangeProviders.event;

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly secretStorage: vscode.SecretStorage
  ) {}

  /**
   * Returns all configured providers from Memento storage.
   */
  public getProviders(): ProviderEntry[] {
    const raw = this.globalState.get<ProviderEntry[]>(STORAGE_KEY_PROVIDERS);
    if (!raw || !Array.isArray(raw)) {
      return [];
    }
    return raw;
  }

  /**
   * Retrieves a single provider entry by internal ID.
   */
  public getProviderById(id: string): ProviderEntry | undefined {
    return this.getProviders().find(p => p.id === id);
  }

  /**
   * Retrieves the secure API key for a given provider from SecretStorage.
   * Returns undefined if no key was stored or if it's empty.
   */
  public async getApiKey(providerId: string): Promise<string | undefined> {
    const key = await this.secretStorage.get(`apiKey::${providerId}`);
    return key || undefined;
  }

  /**
   * Checks if an API key exists and is non-empty for a provider.
   */
  public async hasApiKey(providerId: string): Promise<boolean> {
    const key = await this.getApiKey(providerId);
    return typeof key === 'string' && key.trim().length > 0;
  }

  /**
   * Adds a new provider entry to Memento and its API key to SecretStorage.
   */
  public async addProvider(
    data: Omit<ProviderEntry, 'id' | 'createdAt'>,
    apiKey?: string
  ): Promise<ProviderEntry> {
    const providers = this.getProviders();
    const id = this.generateUuid();

    const normalizedBaseUrl = this.normalizeBaseUrl(data.baseUrl);

    const entry: ProviderEntry = {
      id,
      nickname: data.nickname.trim(),
      baseUrl: normalizedBaseUrl,
      createdAt: Date.now(),
      defaultCapabilities: data.defaultCapabilities,
      customModels: data.customModels,
      customHeaders: data.customHeaders
    };

    providers.push(entry);
    await this.globalState.update(STORAGE_KEY_PROVIDERS, providers);

    if (apiKey && apiKey.trim().length > 0) {
      await this.secretStorage.store(`apiKey::${id}`, apiKey.trim());
    } else {
      await this.secretStorage.delete(`apiKey::${id}`);
    }

    this._onDidChangeProviders.fire();
    return entry;
  }

  /**
   * Updates an existing provider and optionally rotates its API key.
   */
  public async updateProvider(
    providerId: string,
    updates: Partial<Omit<ProviderEntry, 'id' | 'createdAt'>>,
    newApiKey?: string
  ): Promise<ProviderEntry | undefined> {
    const providers = this.getProviders();
    const index = providers.findIndex(p => p.id === providerId);
    if (index === -1) {
      return undefined;
    }

    const existing = providers[index];
    const updated: ProviderEntry = {
      ...existing,
      ...updates,
      nickname: updates.nickname !== undefined ? updates.nickname.trim() : existing.nickname,
      baseUrl: updates.baseUrl !== undefined ? this.normalizeBaseUrl(updates.baseUrl) : existing.baseUrl
    };

    providers[index] = updated;
    await this.globalState.update(STORAGE_KEY_PROVIDERS, providers);

    if (newApiKey !== undefined) {
      if (newApiKey.trim().length > 0) {
        await this.secretStorage.store(`apiKey::${providerId}`, newApiKey.trim());
      } else {
        await this.secretStorage.delete(`apiKey::${providerId}`);
      }
    }

    this._onDidChangeProviders.fire();
    return updated;
  }

  /**
   * Removes a provider and permanently deletes its encrypted secret key.
   */
  public async deleteProvider(providerId: string): Promise<boolean> {
    const providers = this.getProviders();
    const filtered = providers.filter(p => p.id !== providerId);
    if (filtered.length === providers.length) {
      return false;
    }

    await this.globalState.update(STORAGE_KEY_PROVIDERS, filtered);
    await this.secretStorage.delete(`apiKey::${providerId}`);

    this._onDidChangeProviders.fire();
    return true;
  }

  /**
   * Ensures base URLs don't have trailing slashes.
   */
  public normalizeBaseUrl(url: string): string {
    let clean = url.trim();
    while (clean.endsWith('/')) {
      clean = clean.slice(0, -1);
    }
    return clean;
  }

  /**
   * Generates a random standard UUID v4 string.
   */
  private generateUuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
