import { Account } from 'algosdk'
import { optInAsset } from '../../utils/opt-in'
import { transferAsset } from '../../utils/transactions'
import { safeCreateCurrencyAsset, createCurrencyAsset } from './create-currency'

export async function createKYCToken(creator: Account, local = true) {
  if (local) {
    return await safeCreateCurrencyAsset(creator, 'ID', 0)
  } else {
    return await createCurrencyAsset(creator, { name: 'ID', unitName: 'ID', decimals: 0 })
  }
}

export async function whitelistInvestor(investor: Account, kycOwner: Account, idTokenId: number) {
  await optInAsset(investor, idTokenId)
  await transferAsset(kycOwner, investor.addr, idTokenId)
}
