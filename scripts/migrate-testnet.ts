import algosdk from 'algosdk'

import fs from 'fs/promises'
import path from 'path'

import { deployMatchingApp } from '../operations/deploy-app'
import { createCurrencyAsset } from '../tests/utils/create-currency'
import { createKYCToken } from '../tests/utils/kyc'
import { createDummyMintingApplication } from '../tests/utils/mint'

// Need to set the following environment variables:
// CREATOR_MNEMONIC, ADMIN_MNEMONIC, ALGOD_SERVER, ALGOD_TOKEN, ALGOD_PORT
;(async () => {
  const pathToConfig = path.join(__dirname, '../../external-api/config/testnet-constants.json')

  // Creator account from MNEMONIC
  const creator = algosdk.mnemonicToSecretKey(process.env.CREATOR_MNEMONIC)
  console.log('Creator address', creator.addr)

  const admin = algosdk.mnemonicToSecretKey(process.env.ADMIN_MNEMONIC)
  console.log('Admin address', admin.addr)

  console.log('Creating currency asset')
  const currencyId = await createCurrencyAsset(creator, { name: 'USDC', unitName: 'USDC', decimals: 6 })
  console.log('Currency token ID', currencyId)

  console.log('Creating identity token')
  const local = false
  const identityTokenId = await createKYCToken(creator, local)
  console.log('Identity token ID', identityTokenId)

  console.log('Creating fake minting app')
  const { appId: minterId, programHash, enclaveKeys } = await createDummyMintingApplication(creator)
  console.log('Minting app ID', minterId)

  console.log('Creating matching app')
  const appId = await deployMatchingApp({ sender: admin, identityTokenId, minterId, currencyId })
  console.log('Matching app ID', appId)

  const configObj = {
    CREATOR_MNEMONIC: algosdk.secretKeyToMnemonic(creator.sk),
    ADMIN_MNEMONIC: algosdk.secretKeyToMnemonic(admin.sk),
    USDC_ASSET_ID: currencyId,
    ID_ASSET_ID: identityTokenId,
    MINTING_APP_ID: minterId,
    MATCHING_APP_ID: appId,
    MINTING_APP_PROGRAM_HASH: Buffer.from(programHash).toString('hex'),
    TEST_ENCLAVE_PRIVATE_KEY: Buffer.from(enclaveKeys.secretKey).toString('hex'),
  }

  return await fs.writeFile(pathToConfig, JSON.stringify(configObj))
})()
