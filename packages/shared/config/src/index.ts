export const getEnv = (key: string, fallback?: string): string => {
  const value = process.env[key];
  if (value !== undefined) {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Missing required env var: ${key}`);
};

export const getEnvInt = (key: string, fallback?: number): number => {
  const raw = process.env[key];
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${key}`);
  }
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new Error(`Invalid integer env var: ${key}`);
  }
  return value;
};
