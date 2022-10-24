import minimist from 'minimist'
import * as algosdk from 'algosdk'
import { optInAsset } from '../utils/opt-in'
import { getAndOptInBorrowerEscrow } from '../operations/borrower-escrow'
import { getTemporaryAccount } from '../tests/utils'
import { transferAlgos } from '../utils/transfer-algos'
import { getConfigNumber } from '@appliedblockchain/tallysticks-contract-config'
import { getEnvVar } from './utils'

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

  return admin
}

;(async () => {
  const args = minimist(process.argv.slice(2))
  const mnemonic = args['m']
  const usdcId = parseInt(getEnvVar('USDC_ASSET_ID'))
  const appId = parseInt(getEnvVar('MATCHING_APP_ID'))

  if (!mnemonic) return console.log('Mnemonic is not specified, use -m "mnemonic value"')

  try {
    const borrower = algosdk.mnemonicToSecretKey(mnemonic)

    if (args['useSandbox']) {
      const BORROWER_ESCROW_MINIMUM_BALANCE = getConfigNumber('BORROWER_ESCROW_MINIMUM_BALANCE')
      const MINIMUM_TRANSACTION_FEE = getConfigNumber('MINIMUM_TRANSACTION_FEE')
      // Escrow will initially pay for 4 transactions: opt in to bidding token, access token, currency and matching app
      const requiredBalance = BORROWER_ESCROW_MINIMUM_BALANCE + 4 * MINIMUM_TRANSACTION_FEE

      const admin = await getAdmin()
      await transferAlgos(admin, borrower.addr, requiredBalance)
    }

    await optInAsset(borrower, usdcId)
    const escrow = await getAndOptInBorrowerEscrow(borrower, appId)

    console.log('Setup finished successfully')
    console.log(`Escrow address: ${escrow.address()}`)
    console.log(`Escrow public key: ${algosdk.decodeAddress(escrow.address()).publicKey}`)
  } catch (error) {
    console.log('Setup failed: ')
    console.error(error)
  }
})()
