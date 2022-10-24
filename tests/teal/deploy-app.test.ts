import algosdk from 'algosdk'
import { getConfigNumber } from '@appliedblockchain/tallysticks-contract-config'
import { createMatchingApp, setupMatchingApp } from '../../operations/deploy-app'
import { isAppSetUp } from '../../utils/matching-helpers'
import { optInContract } from '../../utils/opt-in'
import { getTemporaryAccount } from '../utils/account'
import { safeCreateCurrencyAsset } from '../utils/create-currency'
import { isContractLogicEvalException } from '../utils/error'
import { createKYCToken } from '../utils/kyc'
import { verifyTokenState } from '../utils/matching'
import { createDummyMintingApplication } from '../utils/mint'

describe('Operations', () => {
  describe('Invoice contract', () => {
    let creator, idTokenId, usdcId, minterId
    beforeAll(async () => {
      creator = await getTemporaryAccount()
      usdcId = await safeCreateCurrencyAsset(creator, 'USDC', 6)
      idTokenId = await createKYCToken(creator)
      const { appId: mintId } = await createDummyMintingApplication(creator)
      minterId = mintId
    }, 20000)

    it('Creates the matching contract', async () => {
      const appId = await createMatchingApp({ sender: creator, identityTokenId: idTokenId, minterId })
      const appAddress = await algosdk.getApplicationAddress(appId)
      expect(algosdk.isValidAddress(appAddress)).toBe(true)
      expect(await isAppSetUp(appId)).toBe(false)
    }, 50000)

    it('The matching contract cannot be set up by another user', async () => {
      expect.assertions(1)
      const user = await getTemporaryAccount()
      const appId = await createMatchingApp({ sender: creator, identityTokenId: idTokenId, minterId })
      await optInContract(user, appId)
      try {
        await setupMatchingApp(user, appId, usdcId)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 50000)

    it('Creator can setup the matching contract', async () => {
      const appId = await createMatchingApp({ sender: creator, identityTokenId: idTokenId, minterId })
      await setupMatchingApp(creator, appId, usdcId)
      const appAddress = await algosdk.getApplicationAddress(appId)
      await verifyTokenState(appAddress, {
        usdc: 0,
        bid: 1000000000000,
        access: 1000000000000,
        algo: getConfigNumber('MATCHING_APP_MINIMUM_BALANCE'),
      })
    }, 50000)

    it('The matching contract cannot be set up twice', async () => {
      expect.assertions(1)
      const appId = await createMatchingApp({ sender: creator, identityTokenId: idTokenId, minterId })
      await setupMatchingApp(creator, appId, usdcId)
      try {
        await setupMatchingApp(creator, appId, usdcId)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 50000)
  })
})
