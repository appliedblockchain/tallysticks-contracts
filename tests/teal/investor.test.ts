import { getConfigNumber } from '@appliedblockchain/tallysticks-contract-config'
import { getAndOptInEscrow, getEscrow } from '../../operations/escrow'
import { getTemporaryAccount, createAndOptInInvestor } from '../utils/account'
import { algodClient } from '../../utils/init'
import { safeCreateCurrencyAsset } from '../utils/create-currency'
import { deployMatchingApp } from '../../operations/deploy-app'
import { createTransferAssetTxn, signAndSendLsigTxn } from '../../utils/transactions'
import { isContractLogicException, isContractException } from '../utils/error'
import { freeze, invest, withdraw } from '../../operations/investor'
import { unfreeze } from '../../operations/admin'
import { transferAlgos } from '../../utils/transfer-algos'
import { getMatchingAppState, verifyInvest, verifyTokenState, verifyWithdraw } from '../utils/matching'
import { createKYCToken, whitelistInvestor } from '../utils/kyc'
import { createDummyMintingApplication } from '../utils/mint'

describe('Investor actions', () => {
  let creator, admin, usdcId, idTokenId, appId
  beforeAll(async () => {
    creator = await getTemporaryAccount()
    admin = await getTemporaryAccount()

    usdcId = await safeCreateCurrencyAsset(creator, 'USDC', 6)
    idTokenId = await createKYCToken(creator)
    const { appId: minterId } = await createDummyMintingApplication(creator)
    appId = await deployMatchingApp({ sender: admin, identityTokenId: idTokenId, minterId, currencyId: usdcId })
  }, 20000)

  describe('Fund and withdraw', () => {
    let investor, escrow, stateAddresses
    beforeAll(async () => {
      investor = await createAndOptInInvestor(creator, usdcId)
      escrow = await getAndOptInEscrow(investor, appId)
      stateAddresses = { appId, investorAddress: investor.addr, investorEscrowAddress: escrow.address() }
    }, 20000)

    it('Investor can send funds to escrow', async () => {
      const startState = await getMatchingAppState(stateAddresses)
      const investment = 100
      await invest(investor, appId, investment)
      const endState = await getMatchingAppState(stateAddresses)
      verifyInvest(startState, endState, investment)
    }, 20000)

    it('Investor can withdraw funds from escrow', async () => {
      await invest(investor, appId, 100)
      const startState = await getMatchingAppState(stateAddresses)
      const withdrawal = 50
      await withdraw(investor, appId, withdrawal)
      const endState = await getMatchingAppState(stateAddresses)
      verifyWithdraw(startState, endState, withdrawal)
    }, 20000)

    it('Another user cannot withdraw funds from escrow', async () => {
      expect.assertions(1)
      const otherUser = await createAndOptInInvestor(creator, usdcId)
      const escrow = await getEscrow(investor.addr, appId)
      const params = await algodClient.getTransactionParams().do()
      const txn = await createTransferAssetTxn({
        fromAddress: escrow.address(),
        toAddress: otherUser.addr,
        assetId: usdcId,
        amount: 50,
        params,
      })
      try {
        await signAndSendLsigTxn(escrow, txn)
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    }, 20000)
  })

  describe('Freeze an account', () => {
    let investor, escrow
    beforeAll(async () => {
      investor = await createAndOptInInvestor(creator, usdcId)
      escrow = await getAndOptInEscrow(investor, appId)
      await whitelistInvestor(investor, creator, idTokenId)
      const minimumBalance = getConfigNumber('MAX_BIDDING_FEES') + getConfigNumber('UNFREEZE_FEE')
      await transferAlgos(investor, escrow.address(), minimumBalance)
      const initialInvestment =
        (getConfigNumber('MAXIMUM_LOAN_VALUE') * getConfigNumber('USDC_DECIMAL_SCALE')) /
        getConfigNumber('USD_CENTS_SCALE')
      await invest(investor, appId, initialInvestment)
    }, 20000)

    it('Investor can freeze their escrow', async () => {
      await unfreeze(admin, investor.addr, appId)
      await verifyTokenState(escrow.address(), { bid: 1, access: 1 })
      await freeze(investor, appId)
      await verifyTokenState(escrow.address(), { bid: 0, access: 0 })
    })

    it('Investor cannot freeze their escrow if already frozen', async () => {
      expect.assertions(1)
      try {
        await freeze(investor, appId)
      } catch (e) {
        expect(isContractException(e)).toBe(true)
      }
    })

    it('Another user cannot freeze investors escrow escrow', async () => {
      expect.assertions(1)
      const investor2 = await createAndOptInInvestor(creator, usdcId)
      try {
        await freeze(investor2, appId, escrow)
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    })
  })
})
