import { fundAccount, getTemporaryAccount } from './account'

export function getCurrentTimestamp(): number {
  return Math.floor(Date.now() / 1000)
}

export async function incrementLatestTimestamp(seconds: number): Promise<void> {
  await new Promise((r) => setTimeout(r, seconds * 1000))
  const dummyAccount = await getTemporaryAccount()
  await fundAccount(dummyAccount.addr, 1)
}
