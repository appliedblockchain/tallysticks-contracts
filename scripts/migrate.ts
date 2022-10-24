import algosdk from 'algosdk'
import fs from 'fs/promises'
import path from 'path'
import { deployMatchingApp } from '../operations/deploy-app'
import { getTemporaryAccount } from '../tests/utils/account'
import { safeCreateCurrencyAsset } from '../tests/utils/create-currency'
import { createKYCToken } from '../tests/utils/kyc'
import { createDummyMintingApplication } from '../tests/utils/mint'
import { getAppTokenIds } from '../utils/matching-helpers'

const pathToConfig = path.join(__dirname, '../../api-common/config/fake-constants.json')
const pathToEnv = path.join(__dirname, '../../investor-app/.env.local.tmp')

  ; (async () => {
    const creator = await getTemporaryAccount()
    const admin = await getTemporaryAccount()
    const currencyId = await safeCreateCurrencyAsset(creator, 'USDC', 6)
    const identityTokenId = await createKYCToken(creator)
    const { appId: minterId, programHash, enclaveKeys } = await createDummyMintingApplication(creator)
    const appId = await deployMatchingApp({ sender: admin, identityTokenId, minterId, currencyId })
    const tokens = await getAppTokenIds(appId)

    const appConfigObj = {
      USDC_ASSET_ID: currencyId,
      ID_ASSET_ID: identityTokenId,
      MINTING_APP_ID: minterId,
      MINTING_APP_PROGRAM_HASH: Buffer.from(programHash).toString('hex'),
      MATCHING_APP_ID: appId,
      BIDDING_ASSET_ID: tokens.bidId,
      ACCESS_ASSET_ID: tokens.accessId,
    }

    const configObj = {
      CREATOR_MNEMONIC: algosdk.secretKeyToMnemonic(creator.sk),
      ADMIN_MNEMONIC: algosdk.secretKeyToMnemonic(admin.sk),
      TEST_ENCLAVE_PRIVATE_KEY: Buffer.from(enclaveKeys.secretKey).toString('hex'),
      ...appConfigObj,
    }

    let contents = await fs.readFile(pathToEnv, { encoding: 'ascii' })
    Object.keys(appConfigObj).forEach((variableName) => {
      const replacer = new RegExp(`{{${variableName}}}`, 'g')
      contents = contents.replace(replacer, configObj[variableName])
    })
    const data = Buffer.from(contents)
    const pathToEnvOut = pathToEnv.split('.tmp')[0]
    await fs.writeFile(pathToEnvOut, data)

    return await fs.writeFile(pathToConfig, JSON.stringify(configObj))
  })()
