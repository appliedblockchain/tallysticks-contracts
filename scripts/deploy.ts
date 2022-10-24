import fs from 'fs/promises'
import path from 'path'
import algosdk from 'algosdk'
import { createMatchingApp, setupMatchingApp } from '../operations/deploy-app'
import { getTemporaryAccount } from '../tests/utils/account'
import { getAppTokenIds } from '../utils/matching-helpers'
import { getConfigNumber } from '@appliedblockchain/tallysticks-contract-config'
import { getEnvVar } from './utils'

type Output = {
  timestamp?: number
  algodClient?: {
    server: string
    port: string
    token: string
  }
  admin?: {
    address: string
    isGenerated: boolean
    mnemonic?: string
  }
  appId?: number
  biddingTokenId?: number
  accessTokenId?: number
  identityTokenId?: number
  minterId?: number
  bidTimeLimit?: number
  maxBidFees?: number
  currencyId?: number
}

const output = {} as Output

const getAdmin = async (): Promise<algosdk.Account> => {
  const adminMnemonic = getEnvVar('ADMIN_MNEMONIC', '')
  const generateAccount = getEnvVar('GENERATE_ADMIN_ACCOUNT', 'false')

  if (!adminMnemonic && generateAccount !== 'true') {
    throw new Error(
      `Environment variable ADMIN_MNEMONIC not set.\nPlease set it or use:\nexport GENERATE_ADMIN_ACCOUNT=true\nto generate a creator account for testing.`,
    )
  }

  if (adminMnemonic && generateAccount === 'true') {
    throw new Error(`Environment variable ADMIN_MNEMONIC is set but GENERATE_ADMIN_ACCOUNT is enabled.`)
  }

  let admin: algosdk.Account
  if (adminMnemonic) {
    admin = algosdk.mnemonicToSecretKey(adminMnemonic)
  } else {
    admin = await getTemporaryAccount()
  }

  output.admin = {
    address: admin.addr,
    isGenerated: !adminMnemonic,
    mnemonic: adminMnemonic ? undefined : algosdk.secretKeyToMnemonic(admin.sk),
  }

  return admin
}

// Main function
;(async () => {
  output.timestamp = Date.now()

  const admin = await getAdmin()
  const identityTokenId = parseInt(getEnvVar('IDENTITY_ASSET_ID'))
  output.identityTokenId = identityTokenId
  const minterId = parseInt(getEnvVar('SILENTDATA_MINT_APP_ID'))
  output.minterId = minterId
  const bidTimeLimit = getConfigNumber('BID_TIME_LIMIT')
  output.bidTimeLimit = bidTimeLimit
  const maxBidFees = getConfigNumber('MAX_BIDDING_FEES')
  output.maxBidFees = maxBidFees
  const currencyId = parseInt(getEnvVar('CURRENCY_ASSET_ID'))
  output.currencyId = currencyId

  const isDryRun = process.argv.includes('--dry-run')
  if (isDryRun) {
    console.log(`This is a dry-run, not creating & setting up the application`)
  } else {
    console.log(`Creating & setting up the application`)

    const appId = await createMatchingApp({ sender: admin, identityTokenId, minterId, bidTimeLimit, maxBidFees })
    await setupMatchingApp(admin, appId, currencyId)
    output.appId = appId
    const tokens = await getAppTokenIds(appId)
    output.biddingTokenId = tokens.bidId
    output.accessTokenId = tokens.accessId
  }

  // Write the result to a log file
  const outputDir = path.join(__dirname, `./logs`)
  await fs.mkdir(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `./deployment_${output.timestamp}${isDryRun ? '_dry-run' : ''}.json`)
  await fs.writeFile(outputPath, JSON.stringify(output))

  console.log(`Writing to: ${outputPath}`)
  console.log(output)
})()
