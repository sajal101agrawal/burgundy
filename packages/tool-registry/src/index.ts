import type { ToolRegistryEntry } from "@concierge/types";

const registry = new Map<string, ToolRegistryEntry>();

export const seedRegistry = (entries: ToolRegistryEntry[]) => {
  entries.forEach((entry) => registry.set(entry.toolId, entry));
};

export const getToolByCategory = (category: string): ToolRegistryEntry[] => {
  return Array.from(registry.values()).filter((entry) => entry.category.includes(category));
};

export const upsertTool = (entry: ToolRegistryEntry) => {
  registry.set(entry.toolId, entry);
};
