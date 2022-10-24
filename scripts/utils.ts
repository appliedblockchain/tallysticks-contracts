export const getEnvVar = (name: string, defaultValue?: string) => {
  const value = process.env[name]
  if (value !== undefined) {
    return value
  }

  if (defaultValue !== undefined) {
    return defaultValue
  }

  throw new Error(`Environment variable ${name} not set`)
}
