import fs from 'fs/promises'
import path from 'path'
import algosdk from 'algosdk'
import minimist from 'minimist'
import { createCurrencyAsset } from '../tests/utils/create-currency'
import { getTemporaryAccount } from '../tests/utils/account'
import { getEnvVar } from './utils'

type Output = {
  timestamp?: number
  algodClient?: {
    server: string
    port: string
    token: string
  }
  creator?: {
    address: string
    isGenerated: boolean
    mnemonic?: string
  }
  assetId?: number
  name?: string
  unitName?: string
  decimals?: number
  total?: number
}

const output = {} as Output

const getCreator = async (): Promise<algosdk.Account> => {
  const creatorMnemonic = getEnvVar('CREATOR_MNEMONIC', '')
  const generateAccount = getEnvVar('GENERATE_CREATOR_ACCOUNT', 'false')

  if (!creatorMnemonic && generateAccount !== 'true') {
    throw new Error(
      `Environment variable CREATOR_MNEMONIC not set.\nPlease set it or use:\nexport GENERATE_CREATOR_ACCOUNT=true\nto generate a creator account for testing.`,
    )
  }

  if (creatorMnemonic && generateAccount === 'true') {
    throw new Error(`Environment variable CREATOR_MNEMONIC is set but GENERATE_CREATOR_ACCOUNT is enabled.`)
  }

  let creator: algosdk.Account
  if (creatorMnemonic) {
    creator = algosdk.mnemonicToSecretKey(creatorMnemonic)
  } else {
    creator = await getTemporaryAccount()
  }

  output.creator = {
    address: creator.addr,
    isGenerated: !creatorMnemonic,
    mnemonic: creatorMnemonic ? undefined : algosdk.secretKeyToMnemonic(creator.sk),
  }

  return creator
}

// Main function
;(async () => {
  output.timestamp = Date.now()

  const args = minimist(process.argv.slice(2))

  const creator = await getCreator()
  const name = args.name
  output.name = name
  const unitName = args.unitName || name
  output.unitName = unitName
  const decimals = args.decimals || 6
  output.decimals = decimals
  const total = args.total || Number.MAX_SAFE_INTEGER
  output.total = total

  const isDryRun = args['dry-run']
  if (isDryRun) {
    console.log(`This is a dry-run, not creating & setting up the application`)
  } else {
    console.log(`Creating & setting up the application`)

    const assetId = await createCurrencyAsset(creator, { name, unitName, decimals, total })
    output.assetId = assetId
  }

  // Write the result to a log file
  const outputDir = path.join(__dirname, `./logs`)
  await fs.mkdir(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `./asset_${output.timestamp}${isDryRun ? '_dry-run' : ''}.json`)
  await fs.writeFile(outputPath, JSON.stringify(output))

  console.log(`Writing to: ${outputPath}`)
  console.log(output)
})()
