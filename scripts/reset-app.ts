import algosdk from 'algosdk'
import { getEnvVar } from './utils'
import { reclaim, reset } from '../operations'
import { getAppTokenIds } from '../utils/matching-helpers'
import { indexerClient } from '../utils/init'
import { getLocalStateValue } from '../utils/state'

// Main function
;(async () => {
  const adminMnemonic = getEnvVar('ADMIN_MNEMONIC', '')
  const matchAppId = parseInt(getEnvVar('MATCHING_APP_ID'))
  const admin = algosdk.mnemonicToSecretKey(adminMnemonic)

  try {
    await reset(admin, matchAppId)
    console.log('App reset')
  } catch (e) {
    console.log(`Unable to reset app with error ${e}`)
  }

  // Fetch all investors with access tokens
  const tokens = await getAppTokenIds(matchAppId)
  console.log(tokens)

  const escrows = await indexerClient
    .lookupAssetBalances(tokens.accessId)
    .currencyGreaterThan(0)
    .currencyLessThan(2)
    .do()

  console.log(`Returning bidding tokens to ${escrows.balances.length} escrow accounts`)
  for (const escrow of escrows.balances) {
    try {
      console.log(`Escrow ${escrow.address} reclaiming token`)
      const investorAddress = (await getLocalStateValue({
        address: escrow.address,
        appId: matchAppId,
        key: 'investor_address',
        decodeValue: false,
      })) as Buffer
      await reclaim(algosdk.encodeAddress(investorAddress), matchAppId)
    } catch (err) {
      console.log(`Escrow ${escrow.address} unable to reclaim token with error: ${err}`)
    }
  }
})()
